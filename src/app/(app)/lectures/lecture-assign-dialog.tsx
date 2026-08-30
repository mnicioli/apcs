"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserCog } from "lucide-react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { assignLectureResponsibleAction, assignLectureSpeakerAction } from "@/lib/actions/lectures";
import type { DirectoryEntry } from "@/lib/services/profile";
import { ROLE_LABELS } from "@/lib/rbac/rbac.types";
import { normalizeForSearch } from "@/lib/utils";
import type { Lecture, LectureSpeaker } from "@/modules/lecture/lecture.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * ATRIBUIR RESPONSÁVEL OU PALESTRANTE (§41, §42).
 *
 * Duas ações, um componente: o que muda é qual action é chamada e o texto. A
 * mecânica — escolher alguém, ou tirar quem estava — é a mesma.
 *
 * ⚠️ MAS AS DUAS LISTAS NÃO SÃO A MESMA. Responsável é quem responde pela
 * palestra DENTRO da APCS: precisa de conta, e por isso a lista é o diretório.
 * Palestrante é quem apresenta, que quase sempre vem de fora — e ganha, além do
 * diretório, o catálogo de nomes e a opção de digitar um novo. Sem isso, uma
 * palestra criada com palestrante externo não teria como trocar de palestrante:
 * esta é a única tela que mexe nisso depois do cadastro.
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

/**
 * Os prefixos que distinguem as origens dentro de um mesmo `value` de rádio: um
 * id de PERFIL e um NOME de catálogo. Os mesmos de `lecture-form.tsx`, e pelo
 * mesmo motivo — sem eles o código teria de adivinhar de onde veio o valor.
 */
const PERFIL = "p:";
const CATALOGO = "c:";
const OUTRO = "novo";
const NINGUEM = "";

export function LectureAssignDialog({
  lecture,
  field,
  directory,
  speakers = [],
  onDone,
}: {
  lecture: Pick<Lecture, "id" | "name" | "responsible" | "speaker" | "speakerCatalog">;
  field: "responsible" | "speaker";
  directory: DirectoryEntry[];
  /** O catálogo de palestrantes de fora. Ignorado quando o campo é responsável. */
  speakers?: LectureSpeaker[];
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<string>(NINGUEM);
  const [novoNome, setNovoNome] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const searchId = useId();
  const novoId = useId();

  const ehPalestrante = field === "speaker";
  const atual = ehPalestrante ? lecture.speaker : lecture.responsible;
  const rotulo = ehPalestrante ? "palestrante" : "responsável";
  const titulo = ehPalestrante ? "Palestrante" : "Responsável";

  // O que já está definido, na linguagem dos rádios. Um palestrante de fora está
  // em `speakerCatalog`, não em `speaker` — sem este ramo, abrir o diálogo numa
  // palestra com palestrante externo mostraria "Ninguém" marcado, e confirmar
  // sem tocar em nada o APAGARIA.
  const atualValor = atual
    ? `${PERFIL}${atual.id}`
    : ehPalestrante && lecture.speakerCatalog
      ? `${CATALOGO}${lecture.speakerCatalog.name}`
      : NINGUEM;

  useEffect(() => {
    if (!open) return;
    setSelected(atualValor);
    setNovoNome("");
    setTerm("");
    setError(null);
  }, [open, atualValor]);

  const busca = normalizeForSearch(term);

  const filtrados = useMemo(() => {
    if (!busca) return directory;
    return directory.filter(
      (person) =>
        normalizeForSearch(person.fullName ?? "").includes(busca) ||
        normalizeForSearch(person.email).includes(busca),
    );
  }, [directory, busca]);

  const filtradosCatalogo = useMemo(() => {
    if (!ehPalestrante) return [];
    if (!busca) return speakers;
    return speakers.filter((speaker) => normalizeForSearch(speaker.name).includes(busca));
  }, [speakers, busca, ehPalestrante]);

  function fechar() {
    if (isPending) return;
    setOpen(false);
  }

  function confirmar() {
    setError(null);

    const perfil = selected.startsWith(PERFIL) ? selected.slice(PERFIL.length) : "";
    const nomeEscolhido = selected.startsWith(CATALOGO) ? selected.slice(CATALOGO.length) : "";
    const nome = selected === OUTRO ? novoNome.trim() : nomeEscolhido;

    if (selected === OUTRO && nome.length < 2) {
      setError("Informe o nome do palestrante.");
      return;
    }

    startTransition(async () => {
      const result = ehPalestrante
        ? await assignLectureSpeakerAction({
            lectureId: lecture.id,
            profileId: perfil,
            speakerName: nome,
          })
        : await assignLectureResponsibleAction({ lectureId: lecture.id, profileId: perfil });

      if (!result.ok) {
        setError(ACTION_ERROR_MESSAGES[result.error.code]);
        return;
      }

      setOpen(false);
      onDone(perfil || nome ? `${titulo} definido com sucesso.` : `${titulo} removido.`);
      router.refresh();
    });
  }

  const temAlguem = Boolean(atual) || Boolean(ehPalestrante && lecture.speakerCatalog);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <UserCog className="h-4 w-4" aria-hidden="true" />
        {temAlguem ? `Trocar ${rotulo}` : `Definir ${rotulo}`}
      </Button>

      <Dialog open={open} onClose={fechar} title={`Definir ${rotulo}`} description={lecture.name}>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor={searchId}>Buscar {ehPalestrante ? "palestrante" : "pessoa"}</Label>
            <Input
              id={searchId}
              type="search"
              value={term}
              disabled={isPending}
              onChange={(event) => setTerm(event.target.value)}
              placeholder={ehPalestrante ? "Nome ou e-mail" : "Nome ou e-mail"}
            />
          </div>

          <fieldset className="space-y-1">
            <legend className="sr-only">Quem responde por esta palestra</legend>

            {/* "Ninguém" é uma escolha, não a ausência de escolha: é assim que se
                DESATRIBUI, e a remoção fica no histórico como qualquer outra
                mudança. */}
            <Opcao
              value={NINGUEM}
              selected={selected}
              disabled={isPending}
              onSelect={setSelected}
              title={<span className="text-muted-foreground text-sm">Ninguém (remover)</span>}
            />

            <div className="max-h-64 space-y-1 overflow-y-auto">
              {filtradosCatalogo.map((speaker) => (
                <Opcao
                  key={speaker.id}
                  value={`${CATALOGO}${speaker.name}`}
                  selected={selected}
                  disabled={isPending}
                  onSelect={setSelected}
                  title={<span className="text-sm font-medium">{speaker.name}</span>}
                  subtitle="Palestrante"
                />
              ))}

              {filtrados.map((person) => (
                <Opcao
                  key={person.id}
                  value={`${PERFIL}${person.id}`}
                  selected={selected}
                  disabled={isPending}
                  onSelect={setSelected}
                  title={
                    <span className="block truncate text-sm font-medium">
                      {person.fullName ?? person.email}
                    </span>
                  }
                  subtitle={`${ROLE_LABELS[person.role]} · ${person.email}`}
                />
              ))}

              {filtrados.length === 0 && filtradosCatalogo.length === 0 && (
                <p className="text-muted-foreground p-2 text-sm">
                  Nenhum resultado para esta busca.
                </p>
              )}
            </div>

            {/* Fora da área rolável, e de propósito: "Outro" é a saída para quem
                não achou ninguém na lista, e a lista é justamente o que a pessoa
                acabou de rolar até o fim sem sucesso. */}
            {ehPalestrante && (
              <Opcao
                value={OUTRO}
                selected={selected}
                disabled={isPending}
                onSelect={setSelected}
                title={<span className="text-sm font-medium">Outro (digitar o nome)</span>}
                subtitle="Fica salvo para as próximas palestras"
              />
            )}
          </fieldset>

          {selected === OUTRO && (
            <div className="space-y-2">
              <Label htmlFor={novoId}>Nome do palestrante</Label>
              <Input
                id={novoId}
                value={novoNome}
                disabled={isPending}
                autoFocus
                placeholder="Dr. Marcelo Ribeiro"
                onChange={(event) => setNovoNome(event.target.value)}
              />
            </div>
          )}

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

/**
 * Uma linha da lista de escolha.
 *
 * Extraída porque agora são QUATRO formas da mesma linha (ninguém, catálogo,
 * diretório e "outro") e repetir o `<label>` com o rádio dentro quatro vezes é
 * como três delas param de receber a correção que a quarta recebeu.
 */
function Opcao({
  value,
  selected,
  disabled,
  onSelect,
  title,
  subtitle,
}: {
  value: string;
  selected: string;
  disabled: boolean;
  onSelect: (value: string) => void;
  title: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <label className="hover:bg-muted flex cursor-pointer items-start gap-3 rounded-md p-2 transition-colors">
      <input
        type="radio"
        name="lecture-assignee"
        value={value}
        checked={selected === value}
        disabled={disabled}
        onChange={() => onSelect(value)}
        className="accent-primary mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
      />
      <span className="min-w-0">
        {title}
        {subtitle && (
          <span className="text-muted-foreground block truncate text-xs">{subtitle}</span>
        )}
      </span>
    </label>
  );
}
