"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/assert-permission";
import { fail, failFromPostgres, ok, type ActionResult } from "@/lib/actions/errors";
import { createClient } from "@/lib/supabase/server";
import { untyped } from "@/lib/supabase/untyped";
import { getFlowGraph } from "@/lib/services/flows";
import { flowActionDefinition } from "@/modules/flow/flow.actions.registry";
import { pendingFlowActions } from "@/modules/flow/flow.rules";
import {
  attendanceTeamFormSchema,
  flowFormSchema,
  flowNodeFormSchema,
  flowTransitionFormSchema,
  flowVersionNotesSchema,
  type AttendanceTeamFormData,
  type FlowFormData,
  type FlowNodeFormData,
  type FlowTransitionFormData,
} from "@/modules/flow/flow.schema";
import type { FlowStatus, FlowVersionStatus } from "@/modules/flow/flow.types";

/**
 * ACTION = escrita. Sempre `ActionResult`, nunca `throw`.
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 *
 * ⚠️ A ESCRITA DESTE MÓDULO ANDA POR DOIS CAMINHOS, E A DIVISÃO É DELIBERADA:
 *
 *   • O DESENHO (fluxo, nó, transição, time) vai pelo PostgREST, como a Base de
 *     Conhecimento. É CRUD comum, e as regras dele estão em CHECK, em índice
 *     único e no gatilho `flow_graph_draft_only` — ou seja, valem também para um
 *     psql.
 *
 *   • O CICLO DE VIDA (avançar, publicar, ligar, excluir) vai por FUNÇÃO
 *     `security definer`. Não é preferência: as colunas `status`, `definition` e
 *     `active_version_id` foram REVOGADAS de `authenticated`
 *     (20260917000100_flows.sql, seção 19). Um `PATCH` nelas leva 42501. Não
 *     existe caminho que publique sem validar.
 *
 * ⚠️ NENHUMA DESTAS FUNÇÕES ESCREVE A TRILHA DE AUDITORIA. Quem escreve são os
 * gatilhos `on_*_audit` no banco e as próprias funções de ciclo de vida. Uma
 * chamada a `log_admin_action` aqui gravaria a mesma ação duas vezes.
 */

const ROTA = "/flows";

function revalidateFlows() {
  revalidatePath(ROTA);
}

/* -------------------------------------------------------------------------- */
/* Fluxos                                                                     */
/* -------------------------------------------------------------------------- */

export async function createFlowAction(input: FlowFormData): Promise<ActionResult<{ id: string }>> {
  const parsed = flowFormSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string }>("flows.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { data, error } = await untyped(supabase)
      .from("flows")
      .insert({
        name: parsed.data.name,
        description: parsed.data.description || null,
        channel: parsed.data.channel,
        is_entry: parsed.data.isEntry,
      })
      .select("id")
      .returns<{ id: string }[]>()
      .single();

    if (error) return failFromPostgres("flows.create", error, { nome: parsed.data.name });

    revalidateFlows();
    return ok({ id: data.id });
  } catch (error) {
    console.error(`[flows] createFlow falhou: ${error instanceof Error ? error.message : error}`);
    return fail("unexpected");
  }
}

export async function updateFlowAction(
  id: string,
  input: FlowFormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = flowFormSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string }>("flows.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    // ⚠️ SÓ AS COLUNAS DO GRANT DA SEÇÃO 19. Incluir `status` aqui devolveria
    // 42501 — o que a tela traduziria como "você não tem permissão", mandando a
    // pessoa procurar no RBAC um problema que é de privilégio de coluna. Ligar
    // e desligar tem função própria, logo abaixo.
    const { error } = await untyped(supabase)
      .from("flows")
      .update({
        name: parsed.data.name,
        description: parsed.data.description || null,
        channel: parsed.data.channel,
        is_entry: parsed.data.isEntry,
      })
      .eq("id", id);

    if (error) return failFromPostgres("flows.update", error, { id });

    revalidateFlows();
    return ok({ id });
  } catch (error) {
    console.error(`[flows] updateFlow falhou: ${error instanceof Error ? error.message : error}`);
    return fail("unexpected");
  }
}

export async function setFlowStatusAction(
  id: string,
  status: FlowStatus,
): Promise<ActionResult<{ id: string }>> {
  const negado = await assertPermission<{ id: string }>("flows.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await untyped(supabase).rpc("set_flow_status", {
      p_flow_id: id,
      p_status: status,
    });

    if (error) return failFromPostgres("flows.setStatus", error, { id, status });

    revalidateFlows();
    return ok({ id });
  } catch (error) {
    console.error(
      `[flows] setFlowStatus falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

export async function deleteFlowAction(id: string): Promise<ActionResult<{ id: string }>> {
  const negado = await assertPermission<{ id: string }>("flows.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await untyped(supabase).rpc("delete_flow", { p_flow_id: id });

    if (error) return failFromPostgres("flows.delete", error, { id });

    revalidateFlows();
    return ok({ id });
  } catch (error) {
    console.error(`[flows] deleteFlow falhou: ${error instanceof Error ? error.message : error}`);
    return fail("unexpected");
  }
}

/* -------------------------------------------------------------------------- */
/* Versões                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * §4. O único caminho para alterar um fluxo que está no ar.
 *
 * Sem `copyFrom`, a função do banco copia a versão ATIVA — que é o que a pessoa
 * quer em nove de dez vezes: "mexer no fluxo" significa mexer no que está
 * valendo.
 */
export async function createFlowVersionAction(
  flowId: string,
  copyFrom?: string,
  notes?: string,
): Promise<ActionResult<{ id: string; version: number }>> {
  const parsed = flowVersionNotesSchema.safeParse({ notes: notes ?? "" });
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string; version: number }>("flows.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { data, error } = await untyped(supabase).rpc("create_flow_version", {
      p_flow_id: flowId,
      p_copy_from: copyFrom ?? null,
      p_notes: parsed.data.notes || null,
    });

    if (error) return failFromPostgres("flows.createVersion", error, { flowId, copyFrom });
    if (!data) return fail("notFound");

    // A função devolve a linha inteira de `flow_versions`. O cast é o mesmo
    // recurso de `scheduleSurveyAction` — o cliente sem tipos não conhece o
    // formato de retorno da RPC até `pnpm db:types` rodar.
    const criada = data as { id: string; version: number };

    revalidateFlows();
    return ok({ id: criada.id, version: criada.version });
  } catch (error) {
    console.error(
      `[flows] createFlowVersion falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

/** Testar, submeter, aprovar — e voltar para rascunho. Publicar é a de baixo. */
export async function advanceFlowVersionAction(
  versionId: string,
  to: FlowVersionStatus,
): Promise<ActionResult<{ id: string }>> {
  const negado = await assertPermission<{ id: string }>("flows.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await untyped(supabase).rpc("advance_flow_version", {
      p_version_id: versionId,
      p_to: to,
    });

    if (error) return failFromPostgres("flows.advanceVersion", error, { versionId, to });

    revalidateFlows();
    return ok({ id: versionId });
  } catch (error) {
    console.error(
      `[flows] advanceFlowVersion falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

/**
 * A PUBLICAÇÃO — e o rollback do §23, que é a mesma operação com uma versão
 * substituída.
 *
 * ⚠️ A ÚNICA CHECAGEM QUE ACONTECE AQUI, E NÃO NO BANCO. Saber se a ação
 * `consultar_bolsa` tem handler ligado é uma propriedade do BUILD QUE ESTÁ NO AR
 * — o Postgres não tem como conhecê-la. Sem esta barreira, um fluxo publicaria
 * normalmente e travaria na primeira conversa que chegasse ao nó de ação, com
 * uma pessoa do outro lado esperando.
 *
 * Todo o resto (nó inicial, nó final, beco sem saída, órfão, pergunta sem
 * alternativa, time inativo) é conferido por `validate_flow_version()` dentro da
 * função de publicar — ou seja, vale também para um psql.
 */
export async function publishFlowVersionAction(
  versionId: string,
): Promise<ActionResult<{ id: string }>> {
  const negado = await assertPermission<{ id: string }>("flows.write");
  if (negado) return negado;

  try {
    const grafo = await getFlowGraph(versionId);
    const pendentes = pendingFlowActions(grafo);

    if (pendentes.length > 0) {
      console.error(`[flows] publish recusado: acoes sem handler`, {
        versionId,
        acoes: pendentes,
        rotulos: pendentes.map((chave) => flowActionDefinition(chave).label),
      });
      return fail("flowActionNotReady");
    }

    const supabase = await createClient();
    const { error } = await untyped(supabase).rpc("publish_flow_version", {
      p_version_id: versionId,
    });

    if (error) return failFromPostgres("flows.publish", error, { versionId });

    revalidateFlows();
    return ok({ id: versionId });
  } catch (error) {
    console.error(
      `[flows] publishFlowVersion falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

export async function updateFlowVersionNotesAction(
  versionId: string,
  notes: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = flowVersionNotesSchema.safeParse({ notes });
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string }>("flows.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await untyped(supabase)
      .from("flow_versions")
      .update({ notes: parsed.data.notes || null })
      .eq("id", versionId);

    if (error) return failFromPostgres("flows.updateVersionNotes", error, { versionId });

    revalidateFlows();
    return ok({ id: versionId });
  } catch (error) {
    console.error(
      `[flows] updateFlowVersionNotes falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

/* -------------------------------------------------------------------------- */
/* Nós e transições                                                           */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ NÃO EXISTE CHECAGEM DE "A VERSÃO É RASCUNHO?" AQUI, E É DE PROPÓSITO.
 *
 * Quem recusa é o gatilho `flow_graph_draft_only` (FL001), no banco. Repetir a
 * checagem aqui pareceria mais seguro e seria menos: a versão pode ser publicada
 * por outra aba entre a leitura e a escrita, e a checagem em código perde essa
 * corrida em silêncio. O gatilho não perde — ele roda dentro da transação.
 *
 * O que a tela faz com `isVersionEditable` é outra coisa: não OFERECER o botão.
 */
export async function upsertFlowNodeAction(
  versionId: string,
  input: FlowNodeFormData,
  nodeId?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = flowNodeFormSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string }>("flows.write");
  if (negado) return negado;

  const payload = {
    flow_version_id: versionId,
    type: parsed.data.type,
    key: parsed.data.key,
    name: parsed.data.name,
    configuration: parsed.data.configuration,
    position: parsed.data.position,
    is_start: parsed.data.isStart,
  };

  try {
    const supabase = await createClient();

    const { data, error } = nodeId
      ? await untyped(supabase)
          .from("flow_nodes")
          .update(payload)
          .eq("id", nodeId)
          .select("id")
          .returns<{ id: string }[]>()
          .single()
      : await untyped(supabase)
          .from("flow_nodes")
          .insert(payload)
          .select("id")
          .returns<{ id: string }[]>()
          .single();

    if (error) return failFromPostgres("flows.upsertNode", error, { versionId, nodeId });

    revalidateFlows();
    return ok({ id: data.id });
  } catch (error) {
    console.error(
      `[flows] upsertFlowNode falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

export async function deleteFlowNodeAction(nodeId: string): Promise<ActionResult<{ id: string }>> {
  const negado = await assertPermission<{ id: string }>("flows.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    // As transições que tocam este nó caem junto (FK composta com `cascade`) —
    // o que evita o estado inconsistente de uma seta apontando para o vazio.
    const { error } = await untyped(supabase).from("flow_nodes").delete().eq("id", nodeId);

    if (error) return failFromPostgres("flows.deleteNode", error, { nodeId });

    revalidateFlows();
    return ok({ id: nodeId });
  } catch (error) {
    console.error(
      `[flows] deleteFlowNode falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

export async function upsertFlowTransitionAction(
  versionId: string,
  input: FlowTransitionFormData,
  transitionId?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = flowTransitionFormSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string }>("flows.write");
  if (negado) return negado;

  const payload = {
    flow_version_id: versionId,
    source_node_id: parsed.data.sourceNodeId,
    target_node_id: parsed.data.targetNodeId,
    condition: parsed.data.condition,
    label: parsed.data.label || null,
    priority: parsed.data.priority,
  };

  try {
    const supabase = await createClient();

    const { data, error } = transitionId
      ? await untyped(supabase)
          .from("flow_transitions")
          .update(payload)
          .eq("id", transitionId)
          .select("id")
          .returns<{ id: string }[]>()
          .single()
      : await untyped(supabase)
          .from("flow_transitions")
          .insert(payload)
          .select("id")
          .returns<{ id: string }[]>()
          .single();

    if (error)
      return failFromPostgres("flows.upsertTransition", error, { versionId, transitionId });

    revalidateFlows();
    return ok({ id: data.id });
  } catch (error) {
    console.error(
      `[flows] upsertFlowTransition falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

export async function deleteFlowTransitionAction(
  transitionId: string,
): Promise<ActionResult<{ id: string }>> {
  const negado = await assertPermission<{ id: string }>("flows.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await untyped(supabase)
      .from("flow_transitions")
      .delete()
      .eq("id", transitionId);

    if (error) return failFromPostgres("flows.deleteTransition", error, { transitionId });

    revalidateFlows();
    return ok({ id: transitionId });
  } catch (error) {
    console.error(
      `[flows] deleteFlowTransition falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

/* -------------------------------------------------------------------------- */
/* Times de atendimento (§11)                                                 */
/* -------------------------------------------------------------------------- */

export async function upsertAttendanceTeamAction(
  input: AttendanceTeamFormData,
  teamId?: string,
): Promise<ActionResult<{ id: string }>> {
  const parsed = attendanceTeamFormSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string }>("flows.write");
  if (negado) return negado;

  // ⚠️ A CHAVE NÃO ENTRA NO UPDATE. Ela é o que as versões publicadas guardam
  // (§10): trocá-la faria todo nó ATTENDANT já publicado apontar para um time
  // que não existe mais — e versão publicada não se conserta (§22). O nome muda
  // à vontade; a chave, nunca.
  const payload: Record<string, unknown> = {
    name: parsed.data.name,
    description: parsed.data.description || null,
    status: parsed.data.status,
  };
  if (!teamId) payload.key = parsed.data.key;

  try {
    const supabase = await createClient();

    const { data, error } = teamId
      ? await untyped(supabase)
          .from("attendance_teams")
          .update(payload)
          .eq("id", teamId)
          .select("id")
          .returns<{ id: string }[]>()
          .single()
      : await untyped(supabase)
          .from("attendance_teams")
          .insert(payload)
          .select("id")
          .returns<{ id: string }[]>()
          .single();

    if (error) return failFromPostgres("flows.upsertTeam", error, { teamId, key: parsed.data.key });

    revalidateFlows();
    return ok({ id: data.id });
  } catch (error) {
    console.error(
      `[flows] upsertAttendanceTeam falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

/**
 * Troca a composição de um time.
 *
 * ⚠️ ESTA É A OPERAÇÃO QUE O §11 EXISTE PARA TORNAR BARATA. Ela não toca em
 * fluxo, versão, nó nem transição — e é por isso que a Maria pode sair do
 * marketing numa terça sem que ninguém precise republicar coisa alguma.
 */
export async function setAttendanceTeamMembersAction(
  teamId: string,
  profileIds: string[],
): Promise<ActionResult<{ id: string; members: number }>> {
  const negado = await assertPermission<{ id: string; members: number }>("flows.write");
  if (negado) return negado;

  const unicos = [...new Set(profileIds.filter((id) => id.trim() !== ""))];

  try {
    const supabase = await createClient();

    // Apaga e reinsere: a composição é pequena (unidades), e um diff aqui
    // trocaria uma operação simples por duas consultas e um conjunto de casos
    // de borda que não pagam.
    const { error: erroApagar } = await untyped(supabase)
      .from("attendance_team_members")
      .delete()
      .eq("team_id", teamId);

    if (erroApagar) return failFromPostgres("flows.setTeamMembers", erroApagar, { teamId });

    if (unicos.length > 0) {
      const { error } = await untyped(supabase)
        .from("attendance_team_members")
        .insert(unicos.map((profileId) => ({ team_id: teamId, profile_id: profileId })));

      if (error) return failFromPostgres("flows.setTeamMembers", error, { teamId });
    }

    revalidateFlows();
    return ok({ id: teamId, members: unicos.length });
  } catch (error) {
    console.error(
      `[flows] setAttendanceTeamMembers falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}
