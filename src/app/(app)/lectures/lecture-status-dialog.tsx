"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { setLectureStatusAction } from "@/lib/actions/lectures";
import { LECTURE_STATUS_HINTS, LECTURE_STATUS_LABELS } from "@/modules/lecture/lecture.labels";
import { nextStatuses } from "@/modules/lecture/lecture.rules";
import type { Lecture, LectureStatus, LectureTransition } from "@/modules/lecture/lecture.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * ALTERAR SITUAÇÃO (§31, §32, §33, §34, §35).
 *
 * ⚠️ NÃO É UM SELECT COM OS OITO STATUS. As opções vêm do GRAFO lido do banco
 * (`lecture_status_transitions`), então a tela oferece exatamente o que o
 * servidor aceita. Uma solicitação nova não mostra "Realizada", e não porque
 * alguém lembrou de escondê-la: ela não está no grafo.
 *
 * Se o grafo mudar por migration, esta tela muda junto, sem deploy de frontend.
 */
export function LectureStatusDialog({
  lecture,
  transitions,
  onDone,
}: {
  lecture: Pick<Lecture, "id" | "name" | "status">;
  transitions: LectureTransition[];
  /** Chamado no sucesso, com a mensagem que a tela deve anunciar. */
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<LectureStatus | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const reasonId = useId();
  const opcoes = nextStatuses(transitions, lecture.status);

  // §31: sem caminho possível, sem botão. Uma palestra realizada, rejeitada ou
  // cancelada é terminal — oferecer "Alterar situação" ali seria oferecer um
  // diálogo vazio.
  if (opcoes.length === 0) return null;

  // §32/§24/§25: rejeitar e cancelar EXIGEM motivo. Nas demais transições o
  // mesmo campo vira observação opcional — e ela é gravada na trilha do mesmo
  // jeito, porque `set_lecture_status` sempre registra o que recebeu.
  const exigeMotivo = target === "rejected" || target === "cancelled";
  const motivo = reason.trim();
  const faltaMotivo = exigeMotivo && motivo.length < 3;

  function fechar() {
    if (isPending) return;
    setTarget(null);
    setReason("");
    setError(null);
  }

  function confirmar() {
    if (!target || faltaMotivo) return;
    setError(null);

    startTransition(async () => {
      const result = await setLectureStatusAction({
        lectureId: lecture.id,
        status: target,
        reason: motivo || undefined,
      });

      if (!result.ok) {
        setError(ACTION_ERROR_MESSAGES[result.error.code]);
        return;
      }

      const mensagem =
        target === "rejected"
          ? "Solicitação rejeitada com sucesso."
          : target === "cancelled"
            ? "Palestra cancelada com sucesso."
            : target === "approved"
              ? "Solicitação aprovada com sucesso."
              : `Situação alterada para ${LECTURE_STATUS_LABELS[target]}.`;

      setTarget(null);
      setReason("");
      onDone(mensagem);
      // A action já revalida as rotas; isto atualiza a página aberta agora, sem
      // exigir F5 (§69).
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setTarget(opcoes[0] ?? null)}>
        Alterar situação
      </Button>

      <Dialog
        open={target !== null}
        onClose={fechar}
        title="Alterar situação"
        description={lecture.name}
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">Situação atual</p>
              <p className="text-sm font-medium">{LECTURE_STATUS_LABELS[lecture.status]}</p>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">Nova situação</p>
              <p className="text-sm font-medium">{target ? LECTURE_STATUS_LABELS[target] : "—"}</p>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm leading-none font-medium">
              Para onde esta palestra vai
            </legend>

            {opcoes.map((option) => (
              <label
                key={option}
                className="hover:bg-muted flex cursor-pointer items-start gap-3 rounded-md p-2 transition-colors"
              >
                <input
                  type="radio"
                  name="lecture-status"
                  value={option}
                  checked={target === option}
                  disabled={isPending}
                  onChange={() => {
                    setTarget(option);
                    setError(null);
                  }}
                  className="accent-primary mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{LECTURE_STATUS_LABELS[option]}</span>
                  <span className="text-muted-foreground block text-sm">
                    {LECTURE_STATUS_HINTS[option]}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor={reasonId}>
              {exigeMotivo ? (
                <>
                  {target === "rejected" ? "Motivo da rejeição" : "Motivo do cancelamento"}{" "}
                  <span aria-hidden="true">*</span>
                  <span className="sr-only">(obrigatório)</span>
                </>
              ) : (
                "Observação"
              )}
            </Label>
            <Textarea
              id={reasonId}
              rows={3}
              value={reason}
              disabled={isPending}
              aria-invalid={faltaMotivo && reason !== ""}
              aria-describedby={`${reasonId}-dica`}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                exigeMotivo ? "Explique o motivo desta decisão." : "Opcional — fica no histórico."
              }
            />
            <p id={`${reasonId}-dica`} className="text-muted-foreground text-xs">
              {exigeMotivo
                ? "Obrigatório, e fica registrado no histórico da palestra."
                : "Opcional. O que você escrever aqui fica no histórico da palestra."}
            </p>
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
            {/* `loading` já desabilita o botão — dois cliques mandariam dois
                comandos e gerariam duas linhas na auditoria. */}
            <Button
              variant={exigeMotivo ? "destructive" : "default"}
              onClick={confirmar}
              loading={isPending}
              disabled={faltaMotivo}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </>
  );
}
