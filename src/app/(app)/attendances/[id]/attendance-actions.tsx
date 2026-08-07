"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { saveAttendanceNotesAction, setAttendanceStateAction } from "@/lib/actions/attendances";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import {
  attendanceNotesFormSchema,
  type AttendanceCommand,
  type AttendanceNotesFormData,
} from "@/modules/attendance/attendance.schema";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Confirmação de cada comando, na voz de quem acabou de clicar. */
const COMMAND_FEEDBACK: Record<AttendanceCommand, string> = {
  assign: "Atendimento assumido.",
  release: "Atendimento devolvido para a fila.",
  resolve: "Atendimento concluído.",
  reopen: "Atendimento reaberto.",
};

interface Feedback {
  type: "success" | "error";
  text: string;
}

/**
 * Ações do atendimento humano. Segue o padrão de referência
 * (`profile-form.tsx`): React Hook Form + Zod + Server Action + ActionResult.
 *
 * Os botões e o formulário compartilham a área de recado: só uma coisa acontece
 * por vez, e duas mensagens empilhadas fariam a pessoa reler para descobrir
 * qual é a nova.
 */
export function AttendanceActions({
  conversationId,
  isAssigned,
  isResolved,
  defaultNotes,
}: {
  conversationId: string;
  isAssigned: boolean;
  isResolved: boolean;
  defaultNotes: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [pendingCommand, setPendingCommand] = useState<AttendanceCommand | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AttendanceNotesFormData>({
    resolver: zodResolver(attendanceNotesFormSchema),
    defaultValues: { internalNotes: defaultNotes },
  });

  function runCommand(command: AttendanceCommand) {
    setFeedback(null);
    setPendingCommand(command);
    startTransition(async () => {
      const result = await setAttendanceStateAction(conversationId, { command });
      setPendingCommand(null);
      setFeedback(
        result.ok
          ? { type: "success", text: COMMAND_FEEDBACK[command] }
          : { type: "error", text: ACTION_ERROR_MESSAGES[result.error.code] },
      );
    });
  }

  function onSubmit(values: AttendanceNotesFormData) {
    setFeedback(null);
    startTransition(async () => {
      const result = await saveAttendanceNotesAction(conversationId, values);
      setFeedback(
        result.ok
          ? { type: "success", text: "Anotação salva." }
          : { type: "error", text: ACTION_ERROR_MESSAGES[result.error.code] },
      );
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {isResolved ? (
          <Button
            variant="outline"
            onClick={() => runCommand("reopen")}
            loading={pendingCommand === "reopen"}
            disabled={isPending}
          >
            Reabrir atendimento
          </Button>
        ) : (
          <>
            {isAssigned ? (
              <Button
                variant="outline"
                onClick={() => runCommand("release")}
                loading={pendingCommand === "release"}
                disabled={isPending}
              >
                Devolver para a fila
              </Button>
            ) : (
              <Button
                onClick={() => runCommand("assign")}
                loading={pendingCommand === "assign"}
                disabled={isPending}
              >
                Assumir atendimento
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => runCommand("resolve")}
              loading={pendingCommand === "resolve"}
              disabled={isPending}
            >
              Concluir atendimento
            </Button>
          </>
        )}
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="internalNotes">Anotação interna</Label>
          <Textarea
            id="internalNotes"
            rows={4}
            aria-invalid={!!errors.internalNotes}
            placeholder="O que foi combinado com o contato."
            {...register("internalNotes")}
          />
          <p className="text-muted-foreground text-xs">
            Fica só entre o time — o visitante do chat nunca vê este campo.
          </p>
          {errors.internalNotes && (
            <p role="alert" className="text-destructive text-sm">
              {errors.internalNotes.message}
            </p>
          )}
        </div>

        <Button type="submit" variant="outline" disabled={isPending}>
          Salvar anotação
        </Button>
      </form>

      {feedback && (
        <p
          role="status"
          className={
            feedback.type === "success" ? "text-primary-strong text-sm" : "text-destructive text-sm"
          }
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
