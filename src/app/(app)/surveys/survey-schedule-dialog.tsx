"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Loader2, Users } from "lucide-react";
import { estimateAudienceAction } from "@/lib/actions/surveys";
import { ACTION_ERROR_MESSAGES, type ActionResult } from "@/lib/actions/errors";
import { audienceSummary } from "@/modules/survey/survey.labels";
import type { SurveyScheduleInput } from "@/modules/survey/survey.schema";
import type { SurveyAudienceCriterion, SurveyWithQuestion } from "@/modules/survey/survey.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { DateTimeSelect } from "@/components/ui/date-time-select";
import { Label } from "@/components/ui/label";
import { SurveyAudienceSummary } from "./survey-audience-summary";

const AGENDAMENTO_NO_PASSADO = "A data e hora de envio devem ser futuras.";

/**
 * O AGENDAMENTO, com o resumo que evita o erro caro (§34, §35, §72, §73).
 *
 * ⚠️ O RESUMO NÃO É ENFEITE. Agendar é a última porta antes de uma mensagem sair
 * para centenas de pessoas — e é a única operação deste módulo que não dá para
 * desfazer depois que as mensagens saem. Por isso o §72 lista o que precisa
 * estar à vista: título, pergunta, quantas alternativas, público, quantas
 * pessoas, data, hora e anonimato. Ler isso leva cinco segundos e evita mandar a
 * enquete errada para a base inteira.
 *
 * ⚠️ E o número de destinatários é RECALCULADO aqui, na hora. Não é o número que
 * o formulário mostrou minutos atrás: entre uma coisa e outra alguém pode ter
 * cadastrado contatos, e o que vale é quantos serão fotografados AGORA.
 */
export function SurveyScheduleDialog({
  open,
  onClose,
  survey,
  title,
  question,
  optionCount,
  criteria,
  defaults,
  onScheduled,
  schedule,
}: {
  open: boolean;
  onClose: () => void;
  survey: SurveyWithQuestion;
  title: string;
  question: string;
  optionCount: number;
  criteria: SurveyAudienceCriterion[];
  /**
   * ⚠️ AS DATAS VÊM DO FORMULÁRIO, não de `survey`.
   *
   * `survey` é o objeto carregado pelo componente de servidor — ou seja, o estado
   * ANTES do "Salvar e agendar". Inicializar o diálogo com ele fazia o campo de
   * encerramento abrir VAZIO logo depois de a pessoa tê-lo preenchido, e o botão
   * "Confirmar agendamento" nascia desabilitado sem dizer por quê.
   *
   * Encontrado percorrendo o fluxo no navegador: o clique em confirmar
   * simplesmente não fazia nada.
   */
  defaults: { scheduledAt: string; startsAt: string; endsAt: string };
  onScheduled: () => void;
  schedule: (input: SurveyScheduleInput) => Promise<ActionResult<unknown>>;
}) {
  const [scheduledAt, setScheduledAt] = useState(defaults.scheduledAt);
  const [startsAt, setStartsAt] = useState(defaults.startsAt);
  const [endsAt, setEndsAt] = useState(defaults.endsAt);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isEstimating, startEstimate] = useTransition();

  const sendId = useId();
  const endId = useId();

  const chave = JSON.stringify(criteria);

  useEffect(() => {
    if (!open) return;
    setScheduledAt(defaults.scheduledAt);
    setStartsAt(defaults.startsAt);
    setEndsAt(defaults.endsAt);
  }, [open, defaults.scheduledAt, defaults.startsAt, defaults.endsAt]);

  useEffect(() => {
    if (!open) return;
    startEstimate(async () => {
      const result = await estimateAudienceAction(JSON.parse(chave));
      setEstimate(result.ok ? result.data.eligible : null);
    });
  }, [open, chave]);

  // §35. Data no passado não vai ao servidor. O banco aceitaria (a rotina
  // ativaria a enquete na primeira passada), mas o §32 diz que não se agenda
  // para trás — e quase sempre é erro de digitação.
  const noPassado = scheduledAt !== "" && new Date(scheduledAt).getTime() < Date.now();
  const janelaInvalida = startsAt !== "" && endsAt !== "" && new Date(endsAt) <= new Date(startsAt);
  const envioAntesDoInicio =
    startsAt !== "" && scheduledAt !== "" && new Date(scheduledAt) < new Date(startsAt);

  const incompleto = scheduledAt === "" || endsAt === "";
  const invalido = noPassado || janelaInvalida || envioAntesDoInicio || incompleto;

  function confirmar() {
    if (invalido) return;
    setErro(null);

    startTransition(async () => {
      const result = await schedule({
        scheduledAt: new Date(scheduledAt).toISOString(),
        startsAt: startsAt ? new Date(startsAt).toISOString() : "",
        endsAt: new Date(endsAt).toISOString(),
      });

      if (!result.ok) {
        setErro(ACTION_ERROR_MESSAGES[result.error.code]);
        return;
      }

      onScheduled();
    });
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (isPending) return;
        onClose();
      }}
      title="Agendar envio"
      description="Confirme os dados da enquete antes de agendar."
      className="max-w-2xl"
    >
      <div className="space-y-5">
        {/* ⚠️ OS MESMOS DOIS CAMPOS DO FORMULÁRIO, e a simetria não é estética.
            Este diálogo CONFIRMA o que já foi decidido na tela de trás (§73);
            mostrar aqui um "Início das respostas" que lá não existe mais faria
            a confirmação parecer pedir um dado novo — e faria a pessoa duvidar
            do que preencheu. Envio e abertura continuam andando juntos. */}
        {/* ⚠️ UMA COLUNA, E É ARITMÉTICA. O `Dialog` tem largura base
            `w-[min(92vw,32rem)]` — 512px, e o `max-w-2xl` daqui nunca chegou a
            valer nada porque a largura já está travada antes dele. Em duas
            colunas sobram ~224px para cada campo, e o par data+hora precisa de
            ~310px: NUNCA COUBE.

            Foi essa conta que produziu os dois defeitos seguidos — o horário
            quebrando para a linha de baixo, e depois a data cortada em "02/09,"
            quando tirei o piso de largura para impedir a quebra. Empilhar dá
            464px a cada campo, com folga de sobra. */}
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor={sendId}>
              Data e hora do envio <span aria-hidden="true">*</span>
              <span className="sr-only">(obrigatório)</span>
            </Label>
            <DateTimeSelect
              id={sendId}
              label="Data e hora do envio"
              value={scheduledAt}
              disabled={isPending}
              invalid={noPassado || envioAntesDoInicio}
              onChange={(valor) => {
                setScheduledAt(valor);
                setStartsAt(valor);
              }}
            />
            <p className="text-muted-foreground text-xs">
              A mensagem sai neste instante, e a enquete passa a aceitar respostas.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={endId}>
              Encerramento <span aria-hidden="true">*</span>
              <span className="sr-only">(obrigatório)</span>
            </Label>
            <DateTimeSelect
              id={endId}
              label="Encerramento"
              value={endsAt}
              disabled={isPending}
              invalid={janelaInvalida}
              onChange={setEndsAt}
            />
            <p className="text-muted-foreground text-xs">
              Depois deste instante nenhuma resposta é aceita.
            </p>
          </div>
        </div>

        {noPassado && (
          <p role="alert" className="text-destructive text-sm">
            {AGENDAMENTO_NO_PASSADO}
          </p>
        )}
        {janelaInvalida && (
          <p role="alert" className="text-destructive text-sm">
            A data de encerramento deve ser posterior ao início.
          </p>
        )}
        {envioAntesDoInicio && (
          <p role="alert" className="text-destructive text-sm">
            O envio não pode ser anterior ao início da enquete.
          </p>
        )}

        {/* ---------------- §72: o resumo ---------------- */}
        <dl className="border-border bg-muted/30 space-y-2 rounded-md border p-4 text-sm">
          <Resumo termo="Título" valor={title || "—"} />
          <Resumo termo="Pergunta" valor={question || "—"} />
          <Resumo
            termo="Alternativas"
            valor={optionCount === 1 ? "1 alternativa" : `${optionCount} alternativas`}
          />
          <div className="grid grid-cols-[9rem_1fr] gap-2">
            <dt className="text-muted-foreground">Público</dt>
            <dd>
              <SurveyAudienceSummary criteria={criteria} />
            </dd>
          </div>
          <div className="grid grid-cols-[9rem_1fr] gap-2">
            <dt className="text-muted-foreground">Destinatários</dt>
            <dd aria-live="polite">
              {isEstimating ? (
                <span className="text-muted-foreground inline-flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  calculando…
                </span>
              ) : estimate === null ? (
                <span className="text-muted-foreground">não foi possível calcular</span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  {audienceSummary(estimate)}
                </span>
              )}
            </dd>
          </div>
          <Resumo termo="Respostas anônimas" valor={survey.isAnonymous ? "Sim" : "Não"} />
        </dl>

        {/* Zero destinatários é o erro que este diálogo existe para pegar: o
            banco recusaria o agendamento, mas descobrir aqui evita a viagem. */}
        {estimate === 0 && (
          <p role="alert" className="text-destructive text-sm">
            Nenhum contato atende aos critérios selecionados. Revise o público antes de agendar.
          </p>
        )}

        {/* ⚠️ Um botão desabilitado sem explicação é um beco sem saída: a pessoa
            clica, nada acontece, e não há o que consertar porque não há o que
            ler. Esta linha diz exatamente o que falta. */}
        {incompleto && (
          <p className="text-muted-foreground text-sm">
            Informe a data e hora do envio e a data de encerramento para confirmar.
          </p>
        )}

        {erro && (
          <p role="alert" className="text-destructive text-sm">
            {erro}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Voltar para edição
          </Button>
          <Button onClick={confirmar} loading={isPending} disabled={invalido || estimate === 0}>
            Confirmar agendamento
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

function Resumo({ termo, valor }: { termo: string; valor: string }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2">
      <dt className="text-muted-foreground">{termo}</dt>
      <dd className="min-w-0 break-words">{valor}</dd>
    </div>
  );
}
