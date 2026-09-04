import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  getFlow,
  getFlowGraph,
  listAttendanceTeams,
  listFlowVersions,
  validateFlowVersion,
} from "@/lib/services/flows";
import { FLOWS_PAGE_TITLE } from "@/modules/flow/flow.labels";
import type { FlowValidationIssue } from "@/modules/flow/flow.types";
import { FlowBuilder } from "./flow-builder";

export const metadata: Metadata = { title: `Editar fluxo · ${FLOWS_PAGE_TITLE}` };

/**
 * A TELA DO BUILDER — as quatro áreas do §2 do Prompt 2.
 *
 * Este componente é de SERVIDOR e faz uma coisa só: buscar. O canvas, a caixa
 * de ferramentas, o painel de propriedades e o simulador vivem em
 * `flow-builder.tsx`, que é cliente porque arrastar exige o navegador.
 *
 * ⚠️ QUAL VERSÃO ABRE, E POR QUÊ. O parâmetro `?v=` manda; sem ele, abre o
 * RASCUNHO mais recente. Só se não houver rascunho nenhum é que a publicada
 * aparece — em modo de leitura.
 *
 * A ordem importa: quem abre este endereço quase sempre vem para MEXER, e abrir
 * a versão no ar como primeira opção faria a pessoa começar a editar, esbarrar
 * no aviso de "esta versão está congelada" e ter de descobrir sozinha que o
 * caminho era criar uma versão nova.
 */
export default async function FlowBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const role = await getCurrentUserRole();
  if (!hasPermission(role, "flows.read")) redirect("/dashboard");

  const { id } = await params;
  const { v } = await searchParams;

  const [flow, versions, teams] = await Promise.all([
    getFlow(id),
    listFlowVersions(id),
    listAttendanceTeams(),
  ]);

  if (!flow) notFound();

  const escolhida =
    versions.find((versao) => versao.id === v) ??
    versions.find((versao) => versao.status === "draft") ??
    versions.find((versao) => versao.status === "published") ??
    versions[0] ??
    null;

  // Um fluxo sem versão nenhuma não deveria existir — `create_flow_version` roda
  // logo depois de `createFlowAction`. Se acontecer, a tela diz o que fazer em
  // vez de quebrar num `undefined`.
  if (!escolhida) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{flow.name}</h1>
        <p className="text-muted-foreground text-sm">
          Este fluxo ainda não tem nenhuma versão. Volte à lista e crie o fluxo novamente.
        </p>
      </div>
    );
  }

  const [graph, issues] = await Promise.all([
    getFlowGraph(escolhida.id),
    // ⚠️ A VALIDAÇÃO VEM DO BANCO, não do espelho em TypeScript. É a mesma
    // função que `publish_flow_version` chama — assim a lista de pendências que
    // a tela mostra é, literalmente, a lista que vai impedir a publicação.
    validarComTolerancia(escolhida.id),
  ]);

  return (
    <FlowBuilder
      flow={flow}
      versions={versions}
      version={escolhida}
      nodes={graph.nodes}
      transitions={graph.transitions}
      teams={teams}
      issues={issues}
      canWrite={hasPermission(role, "flows.write")}
    />
  );
}

/**
 * ⚠️ A VALIDAÇÃO NÃO PODE DERRUBAR A TELA. Ela é um SERVICE (lança em erro), e
 * um fluxo grande com uma função lenta ou um privilégio faltando derrubaria o
 * Builder inteiro — quem só queria arrastar uma caixinha ficaria sem nada.
 *
 * Lista vazia é a degradação certa: o botão de publicar continua existindo, e a
 * barreira de verdade (`publish_flow_version`) continua de pé do outro lado.
 */
async function validarComTolerancia(versionId: string): Promise<FlowValidationIssue[]> {
  try {
    return await validateFlowVersion(versionId);
  } catch (error) {
    console.error(
      `[flows] validacao da versao ${versionId} falhou: ${
        error instanceof Error ? error.message : error
      }`,
    );
    return [];
  }
}
