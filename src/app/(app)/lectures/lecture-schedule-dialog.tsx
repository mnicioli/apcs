"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { rescheduleLectureAction } from "@/lib/actions/lectures";
import { formatCalendarDate, formatTimeRange } from "@/lib/utils";
import { shiftedEndTime } from "@/modules/lecture/lecture.calendar";
import type { Lecture, LectureConflict } from "@/modules/lecture/lecture.types";
import { TIME_STEP_SECONDS } from "@/lib/time/step";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LectureConflictAlert } from "./lecture-conflict-alert";

/**
 * REAGENDAR (§26, §27, §28, §68).
 *
 * Serve aos dois caminhos: o botão da tela de detalhe e o arrastar-e-soltar do
 * calendário. Por isso ele é CONTROLADO por fora (`open`/`onOpenChange`) e
 * aceita uma data e um horário já sugeridos — o calendário solta a palestra num
 * dia e este diálogo aparece com aquele dia preenchido, pedindo a confirmação
 * que o §26 exige.
 *
 * ⚠️ O ESTADO LOCAL NÃO É ATUALIZADO ANTES DA RESPOSTA (§27). A palestra só se
 * move depois que o servidor confirmou; se ele recusar, nada mudou de lugar e a
 * mensagem explica por quê (§28). Mover primeiro e desfazer depois é como uma
 * tela fica dizendo uma coisa enquanto o banco diz outra.
 */
export function LectureScheduleDialog({
  lecture,
  open,
  onOpenChange,
  suggested,
  onDone,
  trigger = true,
}: {
  lecture: Pick<Lecture, "id" | "name" | "eventDate" | "startTime" | "endTime" | "status">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** O que o arrastar-e-soltar sugeriu. Ausente = o diálogo abre com o valor atual. */
  suggested?: { eventDate: string; startTime?: string | null };
  onDone: (message: string) => void;
  /** `false` quando quem abre é o calendário — ali o gatilho é o próprio arrasto. */
  trigger?: boolean;
}) {
  const router = useRouter();

  const [eventDate, setEventDate] = useState(lecture.eventDate);
  const [startTime, setStartTime] = useState(lecture.startTime ?? "");
  const [endTime, setEndTime] = useState(lecture.endTime ?? "");
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<LectureConflict[]>([]);
  const [isPending, startTransition] = useTransition();

  const dateId = useId();
  const startId = useId();
  const endId = useId();

  // ⚠️ AS DEPENDÊNCIAS SÃO OS VALORES, NÃO O OBJETO. `suggested` é um literal
  // criado a cada renderização do calendário, então depender dele faria este
  // efeito rodar de novo a CADA render — inclusive no render que acabou de
  // receber o aviso de conflito, apagando-o antes de alguém conseguir ler.
  const suggestedDate = suggested?.eventDate;
  const suggestedStart = suggested?.startTime;

  // Reabrir precisa recarregar os valores: sem isto, arrastar para o dia 20,
  // cancelar e arrastar para o dia 22 mostraria o dia 20 de novo.
  useEffect(() => {
    if (!open) return;

    const novoInicio = suggestedStart ?? lecture.startTime ?? "";
    setEventDate(suggestedDate ?? lecture.eventDate);
    setStartTime(novoInicio);

    // ⚠️ A DURAÇÃO ACOMPANHA O ARRASTO. Soltar uma palestra de 09:00–10:00 na
    // faixa das 15:00 sem mexer no término a deixaria terminando ANTES de
    // começar — o diálogo abriria já inválido, sobre um campo em que ninguém
    // encostou. Mover uma palestra de uma hora continua sendo uma palestra de
    // uma hora.
    const mudouInicio = Boolean(suggestedStart) && novoInicio !== lecture.startTime;
    setEndTime(
      mudouInicio
        ? (shiftedEndTime(lecture.startTime, lecture.endTime, novoInicio) ?? "")
        : (lecture.endTime ?? ""),
    );

    setError(null);
    setConflicts([]);
  }, [open, suggestedDate, suggestedStart, lecture.eventDate, lecture.startTime, lecture.endTime]);

  const horarioInvertido = startTime !== "" && endTime !== "" && endTime <= startTime;
  const terminoSemInicio = startTime === "" && endTime !== "";
  const invalido = eventDate === "" || horarioInvertido || terminoSemInicio;

  function fechar() {
    if (isPending) return;
    onOpenChange(false);
  }

  function confirmar() {
    if (invalido) return;
    setError(null);

    startTransition(async () => {
      const result = await rescheduleLectureAction({
        lectureId: lecture.id,
        eventDate,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
      });

      if (!result.ok) {
        // §28: a posição original fica de pé. Nada foi movido na tela porque
        // nada foi movido antes de o servidor responder.
        setError(ACTION_ERROR_MESSAGES[result.error.code]);
        return;
      }

      // §33: o conflito volta JUNTO COM O SUCESSO. A palestra foi reagendada; o
      // aviso é informação para a próxima decisão, não um motivo para desfazer.
      if (result.data.conflicts.length > 0) {
        setConflicts(result.data.conflicts);
        onDone("Palestra reagendada com sucesso.");
        router.refresh();
        return;
      }

      onOpenChange(false);
      onDone("Palestra reagendada com sucesso.");
      router.refresh();
    });
  }

  return (
    <>
      {trigger && (
        <Button variant="outline" size="sm" onClick={() => onOpenChange(true)}>
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          Reagendar
        </Button>
      )}

      <Dialog open={open} onClose={fechar} title="Reagendar palestra" description={lecture.name}>
        <div className="space-y-5">
          <p className="text-sm">
            Deseja alterar a data/horário desta palestra? A palestra continua a mesma — muda apenas
            quando ela acontece, e a mudança fica registrada no histórico.
          </p>

          <div className="text-muted-foreground border-border rounded-md border p-3 text-sm">
            <span className="text-xs">Como está hoje</span>
            <p className="text-foreground text-sm font-medium">
              {formatCalendarDate(lecture.eventDate)} ·{" "}
              {lecture.startTime
                ? formatTimeRange(lecture.startTime, lecture.endTime)
                : "sem horário"}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor={dateId}>
                Data <span aria-hidden="true">*</span>
                <span className="sr-only">(obrigatório)</span>
              </Label>
              <Input
                id={dateId}
                type="date"
                value={eventDate}
                disabled={isPending}
                onChange={(event) => setEventDate(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={startId}>Hora de início</Label>
              <Input
                id={startId}
                type="time"
                step={TIME_STEP_SECONDS}
                value={startTime}
                disabled={isPending}
                aria-invalid={terminoSemInicio}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={endId}>Hora de término</Label>
              <Input
                id={endId}
                type="time"
                step={TIME_STEP_SECONDS}
                value={endTime}
                disabled={isPending}
                aria-invalid={horarioInvertido}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </div>
          </div>

          {horarioInvertido && (
            <p role="alert" className="text-destructive text-sm">
              O horário de término deve ser posterior ao de início.
            </p>
          )}
          {terminoSemInicio && (
            <p role="alert" className="text-destructive text-sm">
              Informe o horário de início antes do de término.
            </p>
          )}

          <LectureConflictAlert conflicts={conflicts} />

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={fechar} disabled={isPending}>
              {conflicts.length > 0 ? "Entendi" : "Cancelar"}
            </Button>
            {conflicts.length === 0 && (
              <Button onClick={confirmar} loading={isPending} disabled={invalido}>
                Confirmar
              </Button>
            )}
          </DialogFooter>
        </div>
      </Dialog>
    </>
  );
}
