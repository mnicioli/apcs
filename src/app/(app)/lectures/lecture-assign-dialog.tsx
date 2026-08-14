"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserCog } from "lucide-react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { assignLectureResponsibleAction, assignLectureSpeakerAction } from "@/lib/actions/lectures";
import type { DirectoryEntry } from "@/lib/services/profile";
import { ROLE_LABELS } from "@/lib/rbac/rbac.types";
import { normalizeForSearch } from "@/lib/utils";
import type { Lecture } from "@/modules/lecture/lecture.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * ATRIBUIR RESPONSÁVEL OU PALESTRANTE (§41, §42).
 *
 * Duas ações, um componente: o que muda é qual action é chamada e o texto. A
 * mecânica — escolher alguém do time, ou tirar quem estava — é a mesma.
 *
 * ⚠️ SOBRE O AUTOCOMPLETE: o §41 pede busca via API para não carregar todos os
 * usuários. A busca acontece no BANCO (`searchDirectory`, com `ilike` sobre nome
 * e e-mail) e a lista já chega limitada a 50. O filtro que roda aqui é sobre
 * essas 50 e existe para a digitação responder na hora, sem uma ida ao servidor
 * por tecla. No dia em que o CRM tiver mais gente que isso, o caminho é chamar
 * `searchDirectory` com o termo — a função já aceita, e nada mais muda.
 *
 * O diretório em si depende da policy `profiles_select_directory`
 * (migration 20260816000000). Sem ela, um Gestor veria só o próprio nome na
 * lista. Ver docs/PALESTRAS.md §11.
 */
export function LectureAssignDialog({
  lecture,
  field,
  directory,
  onDone,
}: {
  lecture: Pick<Lecture, "id" | "name" | "responsible" | "speaker">;
  field: "responsible" | "speaker";
  directory: DirectoryEntry[];
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const searchId = useId();

  const atual = field === "responsible" ? lecture.responsible : lecture.speaker;
  const rotulo = field === "responsible" ? "responsável" : "palestrante";

  useEffect(() => {
    if (!open) return;
    setSelected(atual?.id ?? null);
    setTerm("");
    setError(null);
  }, [open, atual?.id]);

  const filtrados = useMemo(() => {
    const busca = normalizeForSearch(term);
    if (!busca) return directory;
    return directory.filter(
      (person) =>
        normalizeForSearch(person.fullName ?? "").includes(busca) ||
        normalizeForSearch(person.email).includes(busca),
    );
  }, [directory, term]);

  function fechar() {
    if (isPending) return;
    setOpen(false);
  }

  function confirmar() {
    setError(null);

    startTransition(async () => {
      const action =
        field === "responsible" ? assignLectureResponsibleAction : assignLectureSpeakerAction;

      const result = await action({ lectureId: lecture.id, profileId: selected ?? "" });

      if (!result.ok) {
        setError(ACTION_ERROR_MESSAGES[result.error.code]);
        return;
      }

      setOpen(false);
      onDone(
        selected
          ? `${field === "responsible" ? "Responsável" : "Palestrante"} definido com sucesso.`
          : `${field === "responsible" ? "Responsável" : "Palestrante"} removido.`,
      );
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <UserCog className="h-4 w-4" aria-hidden="true" />
        {atual ? `Trocar ${rotulo}` : `Definir ${rotulo}`}
      </Button>

      <Dialog open={open} onClose={fechar} title={`Definir ${rotulo}`} description={lecture.name}>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor={searchId}>Buscar pessoa</Label>
            <Input
              id={searchId}
              type="search"
              value={term}
              disabled={isPending}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Nome ou e-mail"
            />
          </div>

          <fieldset className="space-y-1">
            <legend className="sr-only">Quem responde por esta palestra</legend>

            {/* "Ninguém" é uma escolha, não a ausência de escolha: é assim que se
                DESATRIBUI, e a remoção fica no histórico como qualquer outra
                mudança. */}
            <label className="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-md p-2 transition-colors">
              <input
                type="radio"
                name="lecture-assignee"
                checked={selected === null}
                disabled={isPending}
                onChange={() => setSelected(null)}
                className="accent-primary h-4 w-4 shrink-0 cursor-pointer"
              />
              <span className="text-muted-foreground text-sm">Ninguém (remover)</span>
            </label>

            <div className="max-h-64 overflow-y-auto">
              {filtrados.length === 0 ? (
                <p className="text-muted-foreground p-2 text-sm">
                  Nenhuma pessoa encontrada para esta busca.
                </p>
              ) : (
                filtrados.map((person) => (
                  <label
                    key={person.id}
                    className="hover:bg-muted flex cursor-pointer items-start gap-3 rounded-md p-2 transition-colors"
                  >
                    <input
                      type="radio"
                      name="lecture-assignee"
                      value={person.id}
                      checked={selected === person.id}
                      disabled={isPending}
                      onChange={() => setSelected(person.id)}
                      className="accent-primary mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {person.fullName ?? person.email}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {ROLE_LABELS[person.role]} · {person.email}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={fechar} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={confirmar} loading={isPending}>
              Confirmar
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </>
  );
}
