import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  buildFlowFunnel,
  getFlowErrors,
  getFlowMetrics,
  getFlowSlaQueue,
  readFlowHealth,
  type FlowErrorTotal,
  type FlowHealth,
  type FlowMetrics,
  type FlowSlaEntry,
} from "@/lib/services/flow-monitoring";
import { formatDateTime } from "@/lib/utils";
import { FLOWS_PAGE_TITLE } from "@/modules/flow/flow.labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: `Monitoramento · ${FLOWS_PAGE_TITLE}` };

/**
 * MONITORAMENTO DOS FLUXOS — §28 a §34 do Prompt 5.
 *
 * ⚠️ ELA RESPONDE TRÊS PERGUNTAS, E NADA ALÉM DISSO:
 *
 *   1. os fluxos estão saudáveis?          (§54, o cartão de cada um)
 *   2. onde as conversas estão parando?    (§31, o funil)
 *   3. alguém está esperando demais?       (§35, a fila com prazo)
 *
 * O §29 pede sete indicadores e o §31 pede um funil; os dois saem da MESMA
 * consulta (`flow_metrics`), o que é a razão de eles nunca discordarem na
 * mesma tela. Uma segunda consulta com os próprios `where` divergiria da
 * primeira no dia em que alguém mexesse numa delas — e a tela mostraria dois
 * números diferentes para a mesma coisa, sem dizer qual está certo.
 *
 * ⚠️ E ELA NÃO É UM DASHBOARD. O §31 é explícito: "não precisa ser um dashboard
 * sofisticado neste momento; garantir que os dados sejam disponibilizados". Não
 * há gráfico, não há biblioteca nova, não há tempo real. Há números lidos do
 * banco e uma tabela — que é o que alguém abre quando o atendimento está
 * estranho e precisa de resposta, não de animação.
 */

const PERIODOS = [7, 30, 90] as const;

export default async function FlowMonitoringPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "flows.read")) redirect("/dashboard");

  const { dias } = await searchParams;
  const periodo = PERIODOS.find((p) => String(p) === dias) ?? 30;

  // ⚠️ AS TRÊS EM PARALELO, e nenhuma delas depende da outra. Em série a tela
  // esperaria três idas ao banco somadas — e é justamente a tela que alguém
  // abre com pressa.
  const [metrics, erros, fila] = await Promise.all([
    getFlowMetrics(periodo),
    getFlowErrors(periodo),
    getFlowSlaQueue(),
  ]);

  const ativos = metrics.filter((m) => m.started > 0);
  const total = somar(metrics);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Monitoramento dos fluxos</h1>
          <p className="text-muted-foreground text-sm">
            O que o atendimento automático fez nos últimos {periodo} dias.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {PERIODOS.map((p) => (
            <Button key={p} asChild size="sm" variant={p === periodo ? "default" : "outline"}>
              <Link href={`/flows/monitoring?dias=${p}`}>{p} dias</Link>
            </Button>
          ))}
          <Button asChild variant="ghost" size="sm">
            <Link href="/flows">
              <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
              Fluxos
            </Link>
          </Button>
        </div>
      </div>

      {/* -------- §29. Os indicadores somados -------- */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Indicador titulo="Iniciadas" valor={total.started} />
        <Indicador titulo="Resolvidas pelo bot" valor={total.completed} />
        <Indicador titulo="Transferidas" valor={total.handedOff} />
        <Indicador
          titulo="Abandonadas"
          valor={total.abandoned}
          ajuda="Sem resposta há mais de 24h"
        />
        <Indicador titulo="Com falha" valor={total.failed} destaque={total.failed > 0} />
        <Indicador
          titulo="Não entendidas"
          valor={total.fallbackRuns}
          ajuda="Conversas com pelo menos uma resposta recusada"
        />
      </div>

      {total.started === 0 && (
        <Card>
          <CardContent className="text-muted-foreground py-8 text-center text-sm">
            Nenhuma conversa passou por um fluxo neste período.
            <br />
            {/* ⚠️ A DICA IMPORTA MAIS QUE O NÚMERO ZERO. O motivo mais comum de
                não haver conversa nenhuma não é falta de gente escrevendo: é
                não haver fluxo de ENTRADA publicado, e nesse caso o robô de um
                turno está atendendo tudo sem ninguém perceber. */}
            <span className="text-xs">
              Se você esperava conversas aqui, confira se algum fluxo do canal WhatsApp está marcado
              como <strong>fluxo de entrada</strong> e tem uma versão publicada.
            </span>
          </CardContent>
        </Card>
      )}

      {/* -------- §30 e §54. Por fluxo -------- */}
      {metrics.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Por fluxo</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-border border-b text-left text-xs">
                <tr>
                  <th className="py-2 pr-3 font-medium">Fluxo</th>
                  <th className="py-2 pr-3 font-medium">Situação</th>
                  <th className="py-2 pr-3 text-right font-medium">Iniciadas</th>
                  <th className="py-2 pr-3 text-right font-medium">Concluídas</th>
                  <th className="py-2 pr-3 text-right font-medium">Transferidas</th>
                  <th className="py-2 pr-3 text-right font-medium">Falhas</th>
                  <th className="py-2 pr-3 text-right font-medium">Duração média</th>
                  <th className="py-2 text-right font-medium">Confiança média</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => {
                  const saude = readFlowHealth(m);
                  return (
                    <tr key={m.flowId} className="border-border/60 border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{m.flowName}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={BADGE_POR_SAUDE[saude.status]}>
                          {SAUDE_LABELS[saude.status]}
                        </Badge>
                        {saude.reason && (
                          <span className="text-muted-foreground ml-2 text-xs">{saude.reason}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m.started}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m.completed}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m.handedOff}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m.failed}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatarDuracao(m.avgDurationSeconds)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {m.avgConfidence === null ? "—" : m.avgConfidence.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* -------- §31. O funil -------- */}
      {ativos.map((m) => (
        <Card key={`funil-${m.flowId}`}>
          <CardHeader>
            <CardTitle className="text-base">Funil · {m.flowName}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {buildFlowFunnel(m).map((etapa) => (
              <div key={etapa.label} className="space-y-1">
                <div className="flex items-baseline justify-between text-sm">
                  <span>{etapa.label}</span>
                  <span className="tabular-nums">
                    {etapa.value}
                    {etapa.share !== null && (
                      <span className="text-muted-foreground ml-2 text-xs">{etapa.share}%</span>
                    )}
                  </span>
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded">
                  <div
                    className="bg-primary h-full"
                    style={{ width: `${etapa.share ?? 0}%` }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            ))}
            {/* ⚠️ O AVISO EXISTE PORQUE O FUNIL PARECE MAIS EXATO DO QUE É. As
                etapas não são subconjuntos perfeitos: "resolvidas pelo bot"
                inclui quem foi encerrado por fallback. Ver `buildFlowFunnel`. */}
            <p className="text-muted-foreground pt-1 text-xs">
              As etapas se sobrepõem: uma conversa encerrada por não ter sido entendida conta em
              “resolvidas pelo bot”. Use os números como ordem de grandeza, não como partição.
            </p>
          </CardContent>
        </Card>
      ))}

      {/* -------- §35. A fila com prazo -------- */}
      <Card>
        <CardHeader>
          <CardTitle>Fila de atendimento humano</CardTitle>
        </CardHeader>
        <CardContent>
          {fila.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">
              Nenhuma conversa foi transferida para um time.
            </p>
          ) : (
            <FilaSla itens={fila} />
          )}
        </CardContent>
      </Card>

      {/* -------- §33. Os erros -------- */}
      <Card>
        <CardHeader>
          <CardTitle>Erros</CardTitle>
        </CardHeader>
        <CardContent>
          {erros.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">
              Nenhum passo falhou nos últimos {periodo} dias.
            </p>
          ) : (
            <TabelaErros itens={erros} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pedaços                                                                    */
/* -------------------------------------------------------------------------- */

function Indicador({
  titulo,
  valor,
  ajuda,
  destaque,
}: {
  titulo: string;
  valor: number;
  ajuda?: string;
  destaque?: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-0.5 py-4">
        <p className="text-muted-foreground text-xs">{titulo}</p>
        <p className={`text-2xl font-semibold tabular-nums ${destaque ? "text-destructive" : ""}`}>
          {valor}
        </p>
        {ajuda && <p className="text-muted-foreground text-xs">{ajuda}</p>}
      </CardContent>
    </Card>
  );
}

function FilaSla({ itens }: { itens: FlowSlaEntry[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground border-border border-b text-left text-xs">
          <tr>
            <th className="py-2 pr-3 font-medium">Fluxo</th>
            <th className="py-2 pr-3 font-medium">Time</th>
            <th className="py-2 pr-3 font-medium">Transferida em</th>
            <th className="py-2 pr-3 text-right font-medium">Espera</th>
            <th className="py-2 pr-3 text-right font-medium">Prazo</th>
            <th className="py-2 font-medium">Situação</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((item) => (
            <tr key={item.runId} className="border-border/60 border-b last:border-0">
              <td className="py-2 pr-3">{item.flowName}</td>
              <td className="py-2 pr-3">{item.teamName ?? item.teamKey ?? "—"}</td>
              <td className="py-2 pr-3">{formatDateTime(item.assignedAt)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{item.minutesWaiting} min</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {/* ⚠️ SEM PRAZO NÃO É PRAZO ZERO. Um time sem SLA definido não
                    descumpre nada — a APCS simplesmente não estabeleceu um. */}
                {item.slaMinutes === null ? "—" : `${item.slaMinutes} min`}
              </td>
              <td className="py-2">
                {item.resolvedAt ? (
                  <Badge variant="done">Encerrada</Badge>
                ) : item.firstResponseAt ? (
                  <Badge variant="default">Em atendimento</Badge>
                ) : item.breached ? (
                  <Badge variant="alert">Prazo estourado</Badge>
                ) : (
                  <Badge variant="attention">Aguardando</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TabelaErros({ itens }: { itens: FlowErrorTotal[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground border-border border-b text-left text-xs">
          <tr>
            <th className="py-2 pr-3 font-medium">Fluxo</th>
            <th className="py-2 pr-3 font-medium">Etapa</th>
            <th className="py-2 pr-3 font-medium">Motivo</th>
            <th className="py-2 pr-3 text-right font-medium">Ocorrências</th>
            <th className="py-2 font-medium">Última vez</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((erro, i) => (
            <tr
              key={`${erro.flowId}-${erro.nodeId}-${i}`}
              className="border-border/60 border-b last:border-0"
            >
              <td className="py-2 pr-3">{erro.flowName}</td>
              <td className="py-2 pr-3">{erro.nodeType ?? "—"}</td>
              <td className="py-2 pr-3">{MOTIVO_LABELS[erro.reason] ?? erro.reason}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{erro.occurrences}</td>
              <td className="py-2">{erro.lastSeen ? formatDateTime(erro.lastSeen) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Miudezas                                                                   */
/* -------------------------------------------------------------------------- */

function somar(metrics: FlowMetrics[]): FlowMetrics {
  return metrics.reduce<FlowMetrics>(
    (acc, m) => ({
      ...acc,
      started: acc.started + m.started,
      completed: acc.completed + m.completed,
      handedOff: acc.handedOff + m.handedOff,
      failed: acc.failed + m.failed,
      abandoned: acc.abandoned + m.abandoned,
      fallbackRuns: acc.fallbackRuns + m.fallbackRuns,
      identifiedIntent: acc.identifiedIntent + m.identifiedIntent,
    }),
    {
      flowId: "",
      flowName: "",
      started: 0,
      completed: 0,
      handedOff: 0,
      failed: 0,
      abandoned: 0,
      fallbackRuns: 0,
      // ⚠️ AS MÉDIAS NÃO SE SOMAM, e por isso ficam nulas no total. A média das
      // médias não é a média — ela ignoraria que um fluxo com mil conversas
      // pesa mais que um com três. Um número errado com cara de certo é pior
      // que um traço.
      avgDurationSeconds: null,
      avgConfidence: null,
      identifiedIntent: 0,
    },
  );
}

function formatarDuracao(segundos: number | null): string {
  if (segundos === null) return "—";
  if (segundos < 60) return `${Math.round(segundos)}s`;
  if (segundos < 3600) return `${Math.round(segundos / 60)} min`;
  return `${(segundos / 3600).toFixed(1)} h`;
}

const SAUDE_LABELS: Record<FlowHealth, string> = {
  healthy: "Saudável",
  warning: "Atenção",
  error: "Com problema",
  idle: "Sem movimento",
};

const BADGE_POR_SAUDE: Record<FlowHealth, "default" | "attention" | "done" | "alert"> = {
  healthy: "done",
  warning: "attention",
  error: "alert",
  idle: "default",
};

/**
 * ⚠️ O MOTIVO TÉCNICO VIRA UMA FRASE QUE DIZ O QUE CONSERTAR — a mesma regra do
 * simulador. `no_matching_transition` é útil no log e inútil para quem abriu
 * esta tela: ele quer saber onde falta uma seta.
 */
const MOTIVO_LABELS: Record<string, string> = {
  no_start_node: "O desenho não tem etapa inicial",
  node_not_found: "Etapa apontada não existe mais no desenho",
  no_matching_transition: "Falta uma ligação saindo da etapa",
  not_waiting_reply: "Chegou resposta fora de hora",
  hop_limit: "Ciclo fechado no desenho",
  loop_detected: "A conversa deu voltas sem chegar a lugar nenhum",
  fallback_without_team: "Desfecho é transferir, mas sem time escolhido",
  failed: "Passo falhou",
};
