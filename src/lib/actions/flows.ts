"use server";

import { revalidatePath } from "next/cache";
import { assertPermission } from "@/lib/auth/assert-permission";
import { fail, failFromPostgres, ok, type ActionResult } from "@/lib/actions/errors";
import { createClient } from "@/lib/supabase/server";
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

/**
 * ⚠️ O FLUXO NASCE JÁ COM A v1 EM RASCUNHO, e as duas coisas acontecem aqui.
 *
 * Um fluxo sem versão é um estado que nenhuma tela sabe desenhar: o Builder abre
 * numa versão, o histórico lista versões, publicar publica uma versão. Deixar a
 * criação da v1 para o clique seguinte significaria que uma falha de rede no
 * meio deixaria um fluxo órfão na lista — visível, inútil e sem botão que o
 * conserte.
 *
 * Se a criação da versão falhar, o fluxo é DESFEITO. É a coisa mais próxima de
 * uma transação que dá para fazer daqui: as duas escritas passam por funções
 * diferentes (uma é PostgREST, a outra é RPC) e não compartilham transação.
 */
export async function createFlowAction(
  input: FlowFormData,
): Promise<ActionResult<{ id: string; versionId: string }>> {
  const parsed = flowFormSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const negado = await assertPermission<{ id: string; versionId: string }>("flows.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("flows")
      .insert({
        name: parsed.data.name,
        description: parsed.data.description || null,
        channel: parsed.data.channel,
        is_entry: parsed.data.isEntry,
      } as never)
      .select("id")
      .returns<{ id: string }[]>()
      .single();

    if (error) return failFromPostgres("flows.create", error, { nome: parsed.data.name });

    const { data: versao, error: erroVersao } = await supabase.rpc("create_flow_version", {
      p_flow_id: data.id,
      p_copy_from: null,
      p_notes: null,
    } as never);

    if (erroVersao || !versao) {
      // O fluxo recém-criado ainda não publicou nada e não atendeu ninguém, então
      // `delete_flow` o aceita. Um `delete` direto não passaria: o privilégio foi
      // revogado justamente para que a exclusão passe pelas três recusas dela.
      await supabase.rpc("delete_flow", { p_flow_id: data.id } as never);
      return failFromPostgres("flows.create", erroVersao ?? new Error("sem versao"), {
        nome: parsed.data.name,
      });
    }

    revalidateFlows();
    return ok({ id: data.id, versionId: (versao as { id: string }).id });
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
    const { error } = await supabase
      .from("flows")
      .update({
        name: parsed.data.name,
        description: parsed.data.description || null,
        channel: parsed.data.channel,
        is_entry: parsed.data.isEntry,
      } as never)
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
    const { error } = await supabase.rpc("set_flow_status", {
      p_flow_id: id,
      p_status: status,
    } as never);

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

/**
 * Duplicar um fluxo inteiro (Prompt 2, §16).
 *
 * ⚠️ O FLUXO NOVO NASCE DESLIGADO E SEM SER O PONTO DE ENTRADA — sempre, mesmo
 * que o original fosse os dois. Herdar `is_entry` esbarraria no índice único
 * (um por canal) e devolveria 23505; herdar `status = 'active'` seria pior:
 * uma cópia recém-feita, ainda sem revisão, atendendo gente de verdade.
 *
 * O desenho vem junto porque é o motivo de duplicar: reaproveitar a triagem do
 * WhatsApp para montar a do site sem redesenhar trinta nós. Quem faz a cópia é
 * `create_flow_version`, a mesma função de sempre.
 */
export async function duplicateFlowAction(
  flowId: string,
): Promise<ActionResult<{ id: string; versionId: string }>> {
  const negado = await assertPermission<{ id: string; versionId: string }>("flows.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();

    const { data: original, error: erroLeitura } = await supabase
      .from("flows")
      .select("name, description, channel, active_version_id")
      .eq("id", flowId)
      .returns<
        {
          name: string;
          description: string | null;
          channel: string;
          active_version_id: string | null;
        }[]
      >()
      .maybeSingle();

    if (erroLeitura) return failFromPostgres("flows.duplicate", erroLeitura, { flowId });
    if (!original) return fail("notFound");

    const { data: novo, error: erroFluxo } = await supabase
      .from("flows")
      .insert({
        name: `${original.name} (cópia)`.slice(0, 120),
        description: original.description,
        channel: original.channel,
        is_entry: false,
      } as never)
      .select("id")
      .returns<{ id: string }[]>()
      .single();

    if (erroFluxo) return failFromPostgres("flows.duplicate", erroFluxo, { flowId });

    // De onde copiar: a que está no ar, ou — se nunca houve publicação — a
    // versão mais recente, que é onde o trabalho está.
    const origem = original.active_version_id ?? (await ultimaVersao(supabase, flowId));

    const { data: versao, error: erroVersao } = await supabase.rpc("create_flow_version", {
      p_flow_id: novo.id,
      p_copy_from: origem,
      p_notes: `Cópia de "${original.name}".`,
    } as never);

    if (erroVersao) return failFromPostgres("flows.duplicate", erroVersao, { flowId });

    revalidateFlows();
    return ok({ id: novo.id, versionId: (versao as { id: string }).id });
  } catch (error) {
    console.error(
      `[flows] duplicateFlow falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

async function ultimaVersao(
  supabase: Awaited<ReturnType<typeof createClient>>,
  flowId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("flow_versions")
    .select("id")
    .eq("flow_id", flowId)
    .order("version", { ascending: false })
    .limit(1)
    .returns<{ id: string }[]>()
    .maybeSingle();

  return data?.id ?? null;
}

export async function deleteFlowAction(id: string): Promise<ActionResult<{ id: string }>> {
  const negado = await assertPermission<{ id: string }>("flows.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("delete_flow", { p_flow_id: id } as never);

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
    const { data, error } = await supabase.rpc("create_flow_version", {
      p_flow_id: flowId,
      p_copy_from: copyFrom ?? null,
      p_notes: parsed.data.notes || null,
    } as never);

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
    const { error } = await supabase.rpc("advance_flow_version", {
      p_version_id: versionId,
      p_to: to,
    } as never);

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
    const { error } = await supabase.rpc("publish_flow_version", {
      p_version_id: versionId,
    } as never);

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
    const { error } = await supabase
      .from("flow_versions")
      .update({ notes: parsed.data.notes || null } as never)
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
      ? await supabase
          .from("flow_nodes")
          .update(payload as never)
          .eq("id", nodeId)
          .select("id")
          .returns<{ id: string }[]>()
          .single()
      : await supabase
          .from("flow_nodes")
          .insert(payload as never)
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

/**
 * SÓ A POSIÇÃO — o caminho quente do Builder (Prompt 2, §5 e §14).
 *
 * ⚠️ AÇÃO PRÓPRIA, E NÃO `upsertFlowNodeAction` COM O NÓ INTEIRO. Arrastar
 * acontece o tempo todo, e mandar a configuração completa a cada parada de
 * mouse faria três coisas ruins: trafegar o nó inteiro por um pixel, correr o
 * risco de sobrescrever uma edição que o painel de propriedades acabou de
 * fazer, e obrigar o Zod a revalidar um desenho que não mudou.
 *
 * ⚠️ E ELA NÃO SUJA A TRILHA. O gatilho `flow_audit` ignora o UPDATE em que
 * exclusivamente `position` mudou (20260918000000, seção 2) — sem isso, uma
 * tarde reorganizando um fluxo de trinta nós produziria centenas de linhas
 * dizendo "etapa alterada", e a pergunta que a trilha existe para responder
 * sumiria no ruído.
 *
 * ⚠️ O TETO DE 200 NÃO É DESCONFIANÇA DA TELA: é o que impede uma seleção
 * inteira de um fluxo de mil nós (§23) de virar mil consultas numa chamada só.
 */
export async function saveNodePositionsAction(
  positions: { id: string; x: number; y: number }[],
): Promise<ActionResult<{ saved: number }>> {
  const negado = await assertPermission<{ saved: number }>("flows.write");
  if (negado) return negado;

  const lote = positions.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).slice(0, 200);
  if (lote.length === 0) return ok({ saved: 0 });

  try {
    const supabase = await createClient();

    const resultados = await Promise.all(
      lote.map((p) =>
        supabase
          .from("flow_nodes")
          .update({ position: { x: Math.round(p.x), y: Math.round(p.y) } } as never)
          .eq("id", p.id),
      ),
    );

    const falhou = resultados.find((r) => r.error);
    if (falhou?.error) {
      return failFromPostgres("flows.savePositions", falhou.error, { nos: lote.length });
    }

    // ⚠️ SEM `revalidatePath` AQUI, e é de propósito. Revalidar a rota a cada
    // arrastar derrubaria o cache do servidor e faria o Next remontar a página
    // por baixo do canvas — a tela piscaria no meio do desenho. A posição já
    // está correta na tela; o servidor só precisa saber dela para o próximo
    // carregamento.
    return ok({ saved: lote.length });
  } catch (error) {
    console.error(
      `[flows] saveNodePositions falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

/**
 * Duplicar um nó (Prompt 2, §16).
 *
 * ⚠️ A CÓPIA NÃO LEVA AS SETAS, e não é preguiça. Um nó duplicado com as
 * mesmas saídas cria dois caminhos idênticos partindo do mesmo lugar — e o
 * motor seguiria sempre o de menor prioridade, deixando o outro morto. Quem
 * duplica quer o CONTEÚDO (o texto, as alternativas); as ligações são a parte
 * que muda, e é por isso que ela fica para a pessoa desenhar.
 *
 * ⚠️ E A CÓPIA NUNCA É O NÓ INICIAL. Só existe um por versão (índice único), e
 * herdar `is_start` faria a duplicata ser recusada com 23505 — um erro de banco
 * no lugar de um comportamento óbvio.
 */
export async function duplicateFlowNodeAction(
  nodeId: string,
): Promise<ActionResult<{ id: string }>> {
  const negado = await assertPermission<{ id: string }>("flows.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();

    const { data: original, error: erroLeitura } = await supabase
      .from("flow_nodes")
      .select("flow_version_id, type, key, name, configuration, position")
      .eq("id", nodeId)
      .returns<
        {
          flow_version_id: string;
          type: string;
          key: string;
          name: string;
          configuration: Record<string, unknown>;
          position: { x: number; y: number };
        }[]
      >()
      .maybeSingle();

    if (erroLeitura) return failFromPostgres("flows.duplicateNode", erroLeitura, { nodeId });
    if (!original) return fail("notFound");

    const { data, error } = await supabase
      .from("flow_nodes")
      .insert({
        flow_version_id: original.flow_version_id,
        type: original.type,
        key: await chaveLivre(supabase, original.flow_version_id, original.key),
        name: `${original.name} (cópia)`.slice(0, 120),
        configuration: original.configuration,
        // Deslocada, e não sobreposta: duas caixas no mesmo pixel parecem uma só,
        // e a pessoa acha que o botão não funcionou.
        position: { x: (original.position?.x ?? 0) + 60, y: (original.position?.y ?? 0) + 60 },
        is_start: false,
      } as never)
      .select("id")
      .returns<{ id: string }[]>()
      .single();

    if (error) return failFromPostgres("flows.duplicateNode", error, { nodeId });

    revalidateFlows();
    return ok({ id: data.id });
  } catch (error) {
    console.error(
      `[flows] duplicateFlowNode falhou: ${error instanceof Error ? error.message : error}`,
    );
    return fail("unexpected");
  }
}

/**
 * Uma chave que ainda não existe naquela versão.
 *
 * A chave é única por versão (índice), e o formato só aceita MAIÚSCULAS,
 * números e sublinhado — daí o sufixo `_2`, `_3`. Sem isto, duplicar um nó
 * devolveria 23505, que a tela traduz como "já existe um registro com esses
 * dados" num botão que não pede dado nenhum.
 */
async function chaveLivre(
  supabase: Awaited<ReturnType<typeof createClient>>,
  versionId: string,
  base: string,
): Promise<string> {
  const { data } = await supabase
    .from("flow_nodes")
    .select("key")
    .eq("flow_version_id", versionId)
    .returns<{ key: string }[]>();

  const usadas = new Set((data ?? []).map((n) => n.key));
  const raiz = base.replace(/_\d+$/, "").slice(0, 36);

  for (let n = 2; n < 100; n += 1) {
    const candidata = `${raiz}_${n}`;
    if (!usadas.has(candidata)) return candidata;
  }

  // Cem cópias do mesmo nó é um caso que não acontece; ainda assim, devolver
  // algo único é melhor do que devolver algo que vai colidir.
  return `${raiz}_${Date.now().toString().slice(-6)}`;
}

export async function deleteFlowNodeAction(nodeId: string): Promise<ActionResult<{ id: string }>> {
  const negado = await assertPermission<{ id: string }>("flows.write");
  if (negado) return negado;

  try {
    const supabase = await createClient();
    // As transições que tocam este nó caem junto (FK composta com `cascade`) —
    // o que evita o estado inconsistente de uma seta apontando para o vazio.
    const { error } = await supabase.from("flow_nodes").delete().eq("id", nodeId);

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
      ? await supabase
          .from("flow_transitions")
          .update(payload as never)
          .eq("id", transitionId)
          .select("id")
          .returns<{ id: string }[]>()
          .single()
      : await supabase
          .from("flow_transitions")
          .insert(payload as never)
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
    const { error } = await supabase.from("flow_transitions").delete().eq("id", transitionId);

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
      ? await supabase
          .from("attendance_teams")
          .update(payload as never)
          .eq("id", teamId)
          .select("id")
          .returns<{ id: string }[]>()
          .single()
      : await supabase
          .from("attendance_teams")
          .insert(payload as never)
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
    const { error: erroApagar } = await supabase
      .from("attendance_team_members")
      .delete()
      .eq("team_id", teamId);

    if (erroApagar) return failFromPostgres("flows.setTeamMembers", erroApagar, { teamId });

    if (unicos.length > 0) {
      const { error } = await supabase
        .from("attendance_team_members")
        .insert(unicos.map((profileId) => ({ team_id: teamId, profile_id: profileId })) as never);

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
