"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { registerLectureOutcomeAction } from "@/lib/actions/lectures";
import type { Lecture } from "@/modules/lecture/lecture.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * REGISTRAR O RESULTADO (§26, §38).
 *
 * Só aparece em palestra JÁ REALIZADA — o backend exige isso (PL003), e um botão
 * que sempre falha é pior do que nenhum botão.
 *
 * É um passo separado de "marcar como realizada" porque o §26 é explícito: estes
 * campos podem ser preenchidos depois. Marcar que aconteceu e contar quantos
 * vieram são dois momentos, às vezes dois dias.
 *
 * ⚠️ ZERO PARTICIPANTES É UM VALOR VÁLIDO, e é por isso que o campo distingue
 * vazio de zero: "ninguém apareceu" é um resultado que a APCS precisa registrar,
 * e tratá-lo como "não informado" apagaria justamente o dado que interessa.
 */
export function LectureOutcomeDialog({
  lecture,
  onDone,
}: {
  lecture: Pick<Lecture, "id" | "name" | "status" | "heldAt" | "attendeesActual" | "outcomeNotes">;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [heldAt, setHeldAt] = useState("");
  const [attendees, setAttendees] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dateId = useId();
  const attendeesId = useId();
  const notesId = useId();

  useEffect(() => {
    if (!open) return;
    setHeldAt(lecture.heldAt ?? "");
    setAttendees(lecture.attendeesActual === null ? "" : String(lecture.attendeesActual));
    setNotes(lecture.outcomeNotes ?? "");
    setError(null);
  }, [open, lecture.heldAt, lecture.attendeesActual, lecture.outcomeNotes]);

  if (lecture.status !== "held") return null;

  const numero = attendees.trim();
  const numeroInvalido = numero !== "" && !/^\d+$/.test(numero);

  function fechar() {
    if (isPending) return;
    setOpen(false);
  }

  function confirmar() {
    if (numeroInvalido) return;
    setError(null);

    startTransition(async () => {
      const result = await registerLectureOutcomeAction({
        lectureId: lecture.id,
        heldAt: heldAt || undefined,
        // `""` é "não informado"; `"0"` é zero presentes. A conversão explícita
        // é o que mantém os dois separados até o banco.
        attendeesActual: numero === "" ? undefined : Number(numero),
        outcomeNotes: notes || undefined,
      });

      if (!result.ok) {
        setError(ACTION_ERROR_MESSAGES[result.error.code]);
        return;
      }

      setOpen(false);
      onDone("Resultado registrado com sucesso.");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
        {lecture.attendeesActual === null ? "Registrar resultado" : "Editar resultado"}
      </Button>

      <Dialog open={open} onClose={fechar} title="Resultado da palestra" description={lecture.name}>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor={dateId}>Data de realização</Label>
            <Input
              id={dateId}
              type="date"
              value={heldAt}
              disabled={isPending}
              onChange={(event) => setHeldAt(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Já preenchida com a data da palestra. Ajuste se ela aconteceu em outro dia.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={attendeesId}>Participantes presentes</Label>
            <Input
              id={attendeesId}
              type="number"
              inputMode="numeric"
              min={0}
              value={attendees}
              disabled={isPending}
              aria-invalid={numeroInvalido}
              onChange={(event) => setAttendees(event.target.value)}
              placeholder="63"
            />
            {numeroInvalido && (
              <p role="alert" className="text-destructive text-sm">
                Informe um número inteiro maior ou igual a zero.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor={notesId}>Observações da realização</Label>
            <Textarea
              id={notesId}
              rows={3}
              value={notes}
              disabled={isPending}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Como foi, o que ficou combinado, o que repetir na próxima."
            />
          </div>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={fechar} disabled={isPending}>
              Cancelar
            </Button>
            <Button onClick={confirmar} loading={isPending} disabled={numeroInvalido}>
              Salvar
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </>
  );
}
