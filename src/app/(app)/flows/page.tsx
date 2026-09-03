import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import { listAttendanceTeams, listFlows } from "@/lib/services/flows";
import { formatDateTime } from "@/lib/utils";
import {
  FLOWS_EMPTY,
  FLOWS_EMPTY_FILTERED,
  FLOWS_PAGE_DESCRIPTION,
  FLOWS_PAGE_TITLE,
  FLOW_CHANNEL_LABELS,
  FLOW_STATUS_LABELS,
  flowCoverage,
  flowVersionTag,
} from "@/modules/flow/flow.labels";
import {
  DEFAULT_FLOW_STATUS_FILTER,
  isFlowStatusFilter,
  type FlowChannel,
  type FlowFilters,
} from "@/modules/flow/flow.types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: FLOWS_PAGE_TITLE };

/**
 * A GRID DOS FLUXOS DE ATENDIMENTO.
 *
 * ⚠️ ELA É SÓ DE LEITURA NESTA FUNDAÇÃO, E ISSO É O PROMPT 1 CUMPRINDO O QUE
 * PROMETEU. O §28 exclui o desenhador visual, o canvas e o arrastar — e um
 * formulário provisório para criar nó e transição seria construído para ser
 * jogado fora daqui a um prompt, deixando no caminho um segundo jeito de
 * escrever a mesma coisa.
 *
 * O que existe por baixo já é completo: as actions de
 * `src/lib/actions/flows.ts` criam fluxo, abrem versão, escrevem nó e
 * transição, publicam e fazem rollback. Falta a tela que as chama, e ela é o
 * Prompt 2.
 *
 * ⚠️ A COLUNA MAIS IMPORTANTE É "NO AR", e ela não é o `status` do fluxo. Um
 * fluxo ativo sem versão publicada não existe (o CHECK
 * `flows_active_needs_version` o impede), então "no ar" é a versão — é ela que
 * diz QUAL desenho está atendendo, e é a pergunta que se faz olhando esta lista.
 *
 * A permissão é checada aqui (1ª camada) e a RLS filtra no banco (2ª camada) —
 * as duas contam a mesma história.
 */
export default async function FlowsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; canal?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "flows.read")) redirect("/dashboard");

  const { q, status, canal } = await searchParams;
  const filters: FlowFilters = {
    query: q ?? "",
    // Status desconhecido cai no padrão em vez de mostrar lista vazia: uma URL
    // colada errada não deve parecer "não há nada aqui".
    status: status && isFlowStatusFilter(status) ? status : DEFAULT_FLOW_STATUS_FILTER,
    channel: canal === "whatsapp" || canal === "web" ? (canal as FlowChannel) : "",
  };

  const [flows, teams] = await Promise.all([listFlows(filters), listAttendanceTeams()]);

  const noAr = flows.filter((flow) => flow.status === "active").length;
  const isFiltered =
    filters.query.trim() !== "" || filters.status !== "all" || filters.channel !== "";

  return (
    <div className="space-y-6">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">{FLOWS_PAGE_TITLE}</h1>
        <p className="text-muted-foreground text-sm">{FLOWS_PAGE_DESCRIPTION}</p>
      </div>

      <p className="text-muted-foreground text-sm" role="status">
        {flowCoverage(noAr, flows.length)}
      </p>

      {flows.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 p-6">
            <p className="text-muted-foreground text-sm">
              {isFiltered ? FLOWS_EMPTY_FILTERED : FLOWS_EMPTY}
            </p>
            {!isFiltered && (
              // ⚠️ O VAZIO DIZ O QUE VEM A SEGUIR em vez de só constatar. Uma
              // tela que abre vazia e não explica por quê parece quebrada.
              <p className="text-muted-foreground text-sm">
                A estrutura de fluxos, versões, nós e transições já está no banco. A tela de desenho
                — onde os fluxos são montados e publicados — é a próxima etapa.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Fluxos de atendimento, o canal de cada um e a versão que está no ar
                </caption>
                <thead className="text-muted-foreground border-border border-b text-left">
                  <tr>
                    {["Fluxo", "Canal", "Situação", "No ar", "Versões", "Atualizado"].map(
                      (coluna) => (
                        <th key={coluna} scope="col" className="px-4 py-3 font-medium">
                          {coluna}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {flows.map((flow) => (
                    <tr key={flow.id} className="border-border border-b last:border-0">
                      <th scope="row" className="px-4 py-3 text-left font-medium">
                        {flow.name}
                        {flow.isEntry && (
                          <span className="text-muted-foreground ml-2 text-xs font-normal">
                            (entrada)
                          </span>
                        )}
                      </th>

                      <td className="text-muted-foreground px-4 py-3">
                        {FLOW_CHANNEL_LABELS[flow.channel]}
                      </td>

                      <td className="px-4 py-3">
                        <Badge variant={flow.status === "active" ? "attention" : "default"}>
                          {FLOW_STATUS_LABELS[flow.status]}
                        </Badge>
                      </td>

                      <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                        {flow.activeVersionNumber === null
                          ? "—"
                          : flowVersionTag(flow.activeVersionNumber)}
                      </td>

                      <td className="text-muted-foreground px-4 py-3">{flow.versionCount}</td>

                      <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                        {formatDateTime(flow.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Os times (§11)                                                    */}
      {/* ---------------------------------------------------------------- */}
      {/* ⚠️ ELES APARECEM NA MESMA TELA DE PROPÓSITO. Um fluxo termina num time,
          e a pergunta "para onde isso vai?" é respondida aqui embaixo. Separá-los
          numa tela própria faria conferir um destino exigir duas navegações. */}
      <section className="space-y-3">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold tracking-tight">Times de atendimento</h2>
          <p className="text-muted-foreground text-sm">
            Para onde um fluxo transfere a conversa. Trocar quem está no time não altera fluxo
            nenhum — é por isso que o fluxo aponta para o time, e não para a pessoa.
          </p>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Times de atendimento e quantas pessoas há em cada
                </caption>
                <thead className="text-muted-foreground border-border border-b text-left">
                  <tr>
                    {["Time", "Identificação", "Situação", "Pessoas"].map((coluna) => (
                      <th key={coluna} scope="col" className="px-4 py-3 font-medium">
                        {coluna}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => (
                    <tr key={team.id} className="border-border border-b last:border-0">
                      <th scope="row" className="px-4 py-3 text-left font-medium">
                        {team.name}
                      </th>
                      <td className="text-muted-foreground px-4 py-3 font-mono text-xs">
                        {team.key}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={team.status === "active" ? "attention" : "default"}>
                          {team.status === "active" ? "Ativo" : "Inativo"}
                        </Badge>
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {/* ⚠️ Zero pessoas é um aviso, não um número. Um time
                            vazio recebe conversas que ninguém abre. */}
                        {team.memberCount === 0 ? (
                          <span className="text-destructive">nenhuma</span>
                        ) : (
                          team.memberCount
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
