"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BarChart3, CalendarClock, Pencil, Play, Square, Trash2, Undo2, X } from "lucide-react";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import {
  activateSurveyAction,
  cancelSurveyAction,
  closeSurveyAction,
  deleteSurveyAction,
  unscheduleSurveyAction,
} from "@/lib/actions/surveys";
import { canActivate, canCancel, canClose, canDelete } from "@/modules/survey/survey.rules";
import { surveyEditHref, surveyResultsHref } from "@/modules/survey/survey.routes";
import type { SurveyWithQuestion } from "@/modules/survey/survey.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";

/** O que cada confirmação diz. Os textos do §39 e do §40, palavra por palavra. */
const CONFIRMACOES = {
  activate: {
    titulo: "Ativar enquete",
    texto: "A enquete passará a aceitar respostas imediatamente. Confirma a ativação?",
    botao: "Ativar enquete",
    destrutivo: false,
  },
  close: {
    titulo: "Encerrar enquete",
    texto: "Deseja encerrar esta enquete? Após o encerramento, novas respostas não serão aceitas.",
    botao: "Encerrar enquete",
    destrutivo: false,
  },
  cancel: {
    titulo: "Cancelar enquete",
    texto:
      "Deseja cancelar esta enquete? O envio será interrompido e a enquete não aceitará novas respostas.",
    botao: "Cancelar enquete",
    destrutivo: true,
  },
  unschedule: {
    titulo: "Voltar para rascunho",
    texto:
      "A enquete volta a ser um rascunho e o público já definido é descartado. Você precisará agendar de novo.",
    botao: "Voltar para rascunho",
    destrutivo: false,
  },
  delete: {
    titulo: "Excluir rascunho",
    texto:
      "Este rascunho será excluído permanentemente. Enquetes já agendadas ou ativas não podem ser excluídas — nesses casos, use o cancelamento.",
    botao: "Excluir rascunho",
    destrutivo: true,
  },
} as const;

type Acao = keyof typeof CONFIRMACOES;

/**
 * AS AÇÕES DA ENQUETE (§8, §39, §40, §57).
 *
 * ⚠️ QUAIS BOTÕES APARECEM VEM DAS REGRAS DO DOMÍNIO, não de um `switch` escrito
 * aqui. `canActivate`, `canClose`, `canCancel` e `canDelete` são as mesmas
 * funções que a bateria de testes cobre e que espelham o grafo do banco. Se o
 * fluxo mudar, muda num lugar só.
 *
 * ⚠️ E toda ação destrutiva passa por confirmação (§39, §40) — com o texto
 * dizendo O QUE ACONTECE, não só "tem certeza?". "Tem certeza" não informa nada;
 * "o envio será interrompido e a enquete não aceitará novas respostas" informa.
 */
export function SurveyActions({
  survey,
  canWrite,
  hasResponses,
}: {
  survey: SurveyWithQuestion;
  canWrite: boolean;
  hasResponses: boolean;
}) {
  const router = useRouter();
  const [acao, setAcao] = useState<Acao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // §57. Resultados aparecem para quem LÊ — inclusive o Atendente. É a única
  // ação desta barra que não exige permissão de escrita.
  const mostrarResultados = survey.status !== "draft" || hasResponses;

  function executar() {
    if (!acao) return;
    setErro(null);

    startTransition(async () => {
      const result = await (acao === "activate"
        ? activateSurveyAction(survey.id)
        : acao === "close"
          ? closeSurveyAction(survey.id)
          : acao === "cancel"
            ? cancelSurveyAction(survey.id)
            : acao === "unschedule"
              ? unscheduleSurveyAction(survey.id)
              : deleteSurveyAction(survey.id));

      if (!result.ok) {
        setErro(ACTION_ERROR_MESSAGES[result.error.code]);
        return;
      }

      setAcao(null);
      // Excluir tira a enquete do ar: não há para onde voltar.
      if (acao === "delete") {
        router.push("/surveys");
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  const confirmacao = acao ? CONFIRMACOES[acao] : null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {mostrarResultados && (
          <Button variant="outline" asChild>
            <Link href={surveyResultsHref(survey.id)}>
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              Resultados
            </Link>
          </Button>
        )}

        {canWrite && survey.status !== "closed" && survey.status !== "cancelled" && (
          <Button variant="outline" asChild>
            <Link href={surveyEditHref(survey.id)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Editar
            </Link>
          </Button>
        )}

        {canWrite && survey.status === "scheduled" && (
          <Button variant="outline" onClick={() => setAcao("unschedule")}>
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            Voltar para rascunho
          </Button>
        )}

        {canWrite && canActivate(survey.status) && (
          <Button onClick={() => setAcao("activate")}>
            <Play className="h-4 w-4" aria-hidden="true" />
            Ativar agora
          </Button>
        )}

        {canWrite && canClose(survey.status) && (
          <Button variant="outline" onClick={() => setAcao("close")}>
            <Square className="h-4 w-4" aria-hidden="true" />
            Encerrar
          </Button>
        )}

        {canWrite && canCancel(survey.status) && (
          <Button variant="outline" onClick={() => setAcao("cancel")}>
            <X className="h-4 w-4" aria-hidden="true" />
            Cancelar enquete
          </Button>
        )}

        {canWrite && canDelete(survey.status) && (
          <Button variant="ghost" onClick={() => setAcao("delete")}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Excluir
          </Button>
        )}

        {canWrite && survey.status === "draft" && (
          <Button variant="outline" asChild>
            <Link href={surveyEditHref(survey.id)}>
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
              Agendar envio
            </Link>
          </Button>
        )}
      </div>

      <Dialog
        open={acao !== null}
        onClose={() => {
          if (isPending) return;
          setAcao(null);
          setErro(null);
        }}
        title={confirmacao?.titulo ?? ""}
        description={survey.title}
      >
        <div className="space-y-5">
          <p className="text-sm">{confirmacao?.texto}</p>

          {erro && (
            <p role="alert" className="text-destructive text-sm">
              {erro}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAcao(null);
                setErro(null);
              }}
              disabled={isPending}
            >
              Voltar
            </Button>
            {/* `loading` já desabilita — dois cliques mandariam dois comandos e
                gerariam duas linhas na auditoria (§53, §74). */}
            <Button
              variant={confirmacao?.destrutivo ? "destructive" : "default"}
              onClick={executar}
              loading={isPending}
            >
              {confirmacao?.botao}
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    </>
  );
}
