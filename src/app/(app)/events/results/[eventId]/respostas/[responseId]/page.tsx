import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { getResponseDetail } from "@/lib/services/event-results";
import { formatDateTime } from "@/lib/utils";
import { eventResultsHref } from "@/modules/event/event.results.routes";
import type { ResultsDetailQuestion } from "@/modules/event/event.results.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Resposta da avaliação" };

/**
 * O DETALHE DE UMA RESPOSTA (§15).
 *
 * ============================================================================
 * ⚠️ ELE EXISTE PARA AUDITORIA, e é isso que decide o formato.
 * ============================================================================
 * O §15 é explícito: "esse detalhamento deve permitir auditoria e conferência
 * dos dados". Então a tela não resume nem embeleza: mostra bloco, pergunta e
 * resposta na ordem do formulário, com o VALOR ao lado do rótulo ("5 —
 * Excelente"), que é o que permite refazer a conta da média à mão.
 *
 * ⚠️ CONTRA A VERSÃO QUE A PESSOA LEU (§21, §23). Se o formulário virou v2
 * depois, esta resposta continua sendo exibida com as perguntas da v1 — e a
 * versão aparece no cabeçalho, para quem confere saber contra o que está
 * conferindo.
 *
 * ⚠️ PERGUNTA SEM RESPOSTA APARECE COMO "não respondida", e não sumida. Numa
 * tela de conferência, a ausência é informação: uma pergunta opcional em branco
 * explica por que a contagem daquela pergunta é menor que a das vizinhas.
 *
 * ============================================================================
 * ⚠️ §45 — O EVENTO VAI JUNTO NA CONSULTA.
 * ============================================================================
 * `responseId` vem da URL. Sem o `and pe.event_id = p_event_id` lá no banco, um
 * id trocado abriria a resposta de OUTRO evento — com nome, e-mail e comentário
 * de alguém que não tem nada a ver com esta tela.
 */
export default async function ResponseDetailPage({
  params,
}: {
  params: Promise<{ eventId: string; responseId: string }>;
}) {
  const role = await getCurrentUserRole();
  // §41. O detalhe é a tela mais identificável do módulo — nome, contato e tudo
  // o que a pessoa respondeu. Mesma permissão do painel, mesma checagem.
  if (!hasPermission(role, "results.read")) redirect("/dashboard");

  const { eventId, responseId } = await params;
  const detalhe = await getResponseDetail(eventId, responseId);

  // Não existe, é de outro evento, ou a RLS barrou. Os três chegam iguais.
  if (!detalhe) notFound();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link
            href={eventResultsHref(eventId, {
              tab: "responses",
              query: "",
              filter: "all",
              page: 1,
            })}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Respostas
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{detalhe.fullName}</h1>
          <Badge variant="default">versão {detalhe.version}</Badge>
          {/* §19 do Prompt 2. Rodada acima de 1 significa que a avaliação foi
              REABERTA — e quem confere precisa saber que existe uma resposta
              anterior preservada no banco. */}
          {detalhe.round > 1 && <Badge variant="attention">rodada {detalhe.round}</Badge>}
        </div>

        <p className="text-muted-foreground text-sm">
          {detalhe.companyName} · {detalhe.email}
          {detalhe.whatsapp && ` · ${detalhe.whatsapp}`}
        </p>
        <p className="text-muted-foreground text-sm">
          Respondida em {formatDateTime(detalhe.answeredAt)}
        </p>
      </div>

      {detalhe.sections.map((bloco) => (
        <Card key={`${bloco.position}-${bloco.title}`}>
          <CardContent className="space-y-4 p-5">
            <h2 className="font-semibold tracking-tight">{bloco.title}</h2>

            <dl className="space-y-3">
              {bloco.questions.map((pergunta) => (
                <div
                  key={`${pergunta.position}-${pergunta.prompt}`}
                  className="border-border/60 border-b pb-3 last:border-0 last:pb-0"
                >
                  <dt className="text-muted-foreground text-sm">
                    {pergunta.prompt}
                    {pergunta.isOverall && (
                      <span className="text-primary-strong ml-2 text-xs">· avaliação geral</span>
                    )}
                  </dt>
                  <dd className="mt-1 text-sm">
                    <Resposta pergunta={pergunta} />
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Resposta({ pergunta }: { pergunta: ResultsDetailQuestion }) {
  if (pergunta.answers.length === 0) {
    return <span className="text-muted-foreground">Não respondida</span>;
  }

  return (
    <ul className="space-y-1">
      {pergunta.answers.map((resposta, indice) => (
        <li key={indice}>
          {resposta.text !== null ? (
            // O comentário sai entre aspas, como o §15 mostra — e sem truncar:
            // esta é a tela onde ele é lido inteiro.
            <span className="whitespace-pre-wrap">&ldquo;{resposta.text}&rdquo;</span>
          ) : (
            <>
              {/* ⚠️ VALOR E RÓTULO JUNTOS ("5 — Excelente"), como o §15 pede. O
                  valor sozinho não diz nada a quem confere; o rótulo sozinho
                  não permite refazer a conta da média. */}
              {resposta.value !== null && <span className="tabular-nums">{resposta.value} — </span>}
              {resposta.label ?? "—"}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
