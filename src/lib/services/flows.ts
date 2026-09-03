import "server-only";
import { createClient } from "@/lib/supabase/server";
import { untyped } from "@/lib/supabase/untyped";
import { normalizeForSearch } from "@/lib/utils";
import { flowDefinitionSchema } from "@/modules/flow/flow.schema";
import type {
  AttendanceTeam,
  AttendanceTeamDetail,
  Flow,
  FlowActor,
  FlowDefinition,
  FlowFilters,
  FlowNode,
  FlowRun,
  FlowTransition,
  FlowTransitionCondition,
  FlowValidationIssue,
  FlowVersion,
} from "@/modules/flow/flow.types";

/**
 * SERVICE = leitura. Retorna o dado ou LANÇA erro (o caller decide como tratar).
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 *
 * ⚠️ TUDO AQUI PASSA PELO CLIENTE AUTENTICADO — ou seja, pela RLS de `flows`,
 * `flow_versions`, `flow_nodes`, `flow_transitions` e `flow_runs`. Quem não tem
 * `flows.read` não lê nada por aqui, mesmo que a checagem da tela falhe.
 *
 * ⚠️ NÃO EXISTE PORTA DO CHATBOT NESTE ARQUIVO, e é de propósito: nesta
 * fundação o motor ainda não está ligado ao WhatsApp (§28). Quando estiver, a
 * porta será uma função `security definer` no banco — como `search_knowledge()`
 * — e não uma consulta montada aqui, pelo motivo de sempre: duas consultas com
 * a mesma regra divergem no dia em que a regra mudar.
 */

/**
 * Teto da leitura da grid.
 *
 * A tela lê tudo e filtra em memória, como Documentos e a Base de Conhecimento,
 * e pelo mesmo motivo: a busca por texto usa `normalizeForSearch`, e `ilike` no
 * Postgres é sensível a acento — ninguém digita "triagem" pensando em acento,
 * mas digita "filiação".
 *
 * Uma associação tem dezenas de fluxos, não milhares. Se passar deste teto, o
 * caminho é paginar e mover a busca para uma coluna normalizada com índice.
 */
const LIST_LIMIT = 200;

/* -------------------------------------------------------------------------- */
/* As linhas cruas                                                            */
/* -------------------------------------------------------------------------- */

interface ProfileRef {
  id: string;
  full_name: string | null;
}

function toActor(row: ProfileRef | null): FlowActor | null {
  return row ? { id: row.id, fullName: row.full_name } : null;
}

/**
 * ⚠️ `created_by` e `updated_by` são DUAS chaves estrangeiras para `profiles`
 * nestas tabelas. Sem apontar a constraint, o PostgREST não sabe qual seguir e
 * devolve PGRST201 (ambiguidade) — não um resultado errado, um erro.
 */
const FLOW_COLUMNS =
  "id, name, description, channel, status, is_entry, active_version_id, created_at, updated_at, " +
  "author:profiles!flows_created_by_fkey (id, full_name), " +
  "editor:profiles!flows_updated_by_fkey (id, full_name), " +
  "versions:flow_versions (id, version, status)";

interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  channel: Flow["channel"];
  status: Flow["status"];
  is_entry: boolean;
  active_version_id: string | null;
  created_at: string;
  updated_at: string;
  author: ProfileRef | null;
  editor: ProfileRef | null;
  versions: { id: string; version: number; status: FlowVersion["status"] }[] | null;
}

function toFlow(row: FlowRow): Flow {
  const versoes = row.versions ?? [];
  const ativa = versoes.find((v) => v.id === row.active_version_id) ?? null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    channel: row.channel,
    status: row.status,
    isEntry: row.is_entry,
    activeVersionId: row.active_version_id,
    activeVersionNumber: ativa?.version ?? null,
    versionCount: versoes.length,
    createdBy: toActor(row.author),
    createdAt: row.created_at,
    updatedBy: toActor(row.editor),
    updatedAt: row.updated_at,
  };
}

/* -------------------------------------------------------------------------- */
/* Fluxos                                                                     */
/* -------------------------------------------------------------------------- */

export async function listFlows(filters: FlowFilters): Promise<Flow[]> {
  const supabase = await createClient();

  const { data, error } = await untyped(supabase)
    .from("flows")
    .select(FLOW_COLUMNS)
    .order("name")
    .limit(LIST_LIMIT)
    // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
    .returns<FlowRow[]>();

  if (error) {
    console.error(`[flows] listFlows falhou: ${error.message}`);
    throw error;
  }

  return (data ?? []).map(toFlow).filter((flow) => matchesFlowFilters(flow, filters));
}

/**
 * O filtro da grid — em memória, e por isso testável sem banco.
 *
 * ⚠️ `draft` NÃO É UM STATUS DE FLUXO, e mesmo assim é um filtro. A pergunta que
 * ele responde ("o que ainda não subiu?") não tem coluna: é o fluxo INATIVO que
 * nunca publicou versão nenhuma. Um fluxo inativo que JÁ esteve no ar é outra
 * coisa — foi desligado de propósito — e misturar os dois faria a lista de
 * "pendências" incluir decisões já tomadas.
 */
export function matchesFlowFilters(flow: Flow, filters: FlowFilters): boolean {
  if (filters.channel !== "" && flow.channel !== filters.channel) return false;

  if (filters.status === "active" && flow.status !== "active") return false;
  if (filters.status === "inactive" && flow.status !== "inactive") return false;
  if (filters.status === "draft" && flow.activeVersionId !== null) return false;

  const busca = normalizeForSearch(filters.query.trim());
  if (busca === "") return true;

  return (
    normalizeForSearch(flow.name).includes(busca) ||
    normalizeForSearch(flow.description ?? "").includes(busca)
  );
}

export async function getFlow(id: string): Promise<Flow | null> {
  const supabase = await createClient();

  const { data, error } = await untyped(supabase)
    .from("flows")
    .select(FLOW_COLUMNS)
    .eq("id", id)
    .returns<FlowRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[flows] getFlow falhou: ${error.message}`);
    throw error;
  }

  return data ? toFlow(data) : null;
}

/* -------------------------------------------------------------------------- */
/* Versões                                                                    */
/* -------------------------------------------------------------------------- */

const VERSION_COLUMNS =
  "id, flow_id, version, status, notes, definition, published_at, created_at, updated_at, " +
  "author:profiles!flow_versions_created_by_fkey (id, full_name), " +
  "editor:profiles!flow_versions_updated_by_fkey (id, full_name), " +
  "publisher:profiles!flow_versions_published_by_fkey (id, full_name)";

interface VersionRow {
  id: string;
  flow_id: string;
  version: number;
  status: FlowVersion["status"];
  notes: string | null;
  definition: unknown;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  author: ProfileRef | null;
  editor: ProfileRef | null;
  publisher: ProfileRef | null;
}

function toVersion(row: VersionRow): FlowVersion {
  return {
    id: row.id,
    flowId: row.flow_id,
    version: row.version,
    status: row.status,
    notes: row.notes,
    definition: parseDefinition(row.definition, row.id),
    publishedAt: row.published_at,
    publishedBy: toActor(row.publisher),
    createdBy: toActor(row.author),
    createdAt: row.created_at,
    updatedBy: toActor(row.editor),
    updatedAt: row.updated_at,
  };
}

/**
 * ⚠️ O RETRATO CONGELADO É VALIDADO NA LEITURA, e não confiado.
 *
 * Ele foi escrito por uma versão ANTERIOR do sistema e nunca é reescrito (§22).
 * Sem este parse, um documento de formato desconhecido chegaria ao motor como
 * `unknown` e um campo ausente viraria `undefined` — decidindo o caminho de um
 * atendimento a partir de um buraco.
 *
 * Falhar aqui devolve `null` e REGISTRA, em vez de lançar: uma versão antiga
 * ilegível não pode derrubar a listagem do fluxo inteiro. Quem depende da
 * definição (o motor) trata `null` como "esta versão não roda"; quem só quer
 * ver o histórico continua vendo.
 */
function parseDefinition(bruto: unknown, versionId: string): FlowDefinition | null {
  if (bruto === null || bruto === undefined) return null;

  const parsed = flowDefinitionSchema.safeParse(bruto);
  if (!parsed.success) {
    console.error(
      `[flows] a definicao da versao ${versionId} nao casa com o formato conhecido: ${parsed.error.message}`,
    );
    return null;
  }

  return parsed.data as FlowDefinition;
}

export async function listFlowVersions(flowId: string): Promise<FlowVersion[]> {
  const supabase = await createClient();

  const { data, error } = await untyped(supabase)
    .from("flow_versions")
    .select(VERSION_COLUMNS)
    .eq("flow_id", flowId)
    .order("version", { ascending: false })
    .returns<VersionRow[]>();

  if (error) {
    console.error(`[flows] listFlowVersions falhou: ${error.message}`);
    throw error;
  }

  return (data ?? []).map(toVersion);
}

export async function getFlowVersion(id: string): Promise<FlowVersion | null> {
  const supabase = await createClient();

  const { data, error } = await untyped(supabase)
    .from("flow_versions")
    .select(VERSION_COLUMNS)
    .eq("id", id)
    .returns<VersionRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[flows] getFlowVersion falhou: ${error.message}`);
    throw error;
  }

  return data ? toVersion(data) : null;
}

/* -------------------------------------------------------------------------- */
/* O desenho editável                                                         */
/* -------------------------------------------------------------------------- */

interface NodeRow {
  id: string;
  flow_version_id: string;
  type: FlowNode["type"];
  key: string;
  name: string;
  configuration: Record<string, unknown> | null;
  position: { x: number; y: number } | null;
  metadata: Record<string, unknown> | null;
  is_start: boolean;
}

interface TransitionRow {
  id: string;
  flow_version_id: string;
  source_node_id: string;
  target_node_id: string;
  condition: FlowTransitionCondition;
  label: string | null;
  priority: number;
}

/** O grafo de uma versão — as linhas, não o retrato. Ver `flow.types.ts`. */
export async function getFlowGraph(
  versionId: string,
): Promise<{ nodes: FlowNode[]; transitions: FlowTransition[] }> {
  const supabase = await createClient();

  const [nos, setas] = await Promise.all([
    untyped(supabase)
      .from("flow_nodes")
      .select("id, flow_version_id, type, key, name, configuration, position, metadata, is_start")
      .eq("flow_version_id", versionId)
      .order("key")
      .returns<NodeRow[]>(),
    untyped(supabase)
      .from("flow_transitions")
      .select("id, flow_version_id, source_node_id, target_node_id, condition, label, priority")
      .eq("flow_version_id", versionId)
      .order("priority")
      .returns<TransitionRow[]>(),
  ]);

  if (nos.error) {
    console.error(`[flows] getFlowGraph (nos) falhou: ${nos.error.message}`);
    throw nos.error;
  }
  if (setas.error) {
    console.error(`[flows] getFlowGraph (transicoes) falhou: ${setas.error.message}`);
    throw setas.error;
  }

  return {
    nodes: (nos.data ?? []).map((row) => ({
      id: row.id,
      flowVersionId: row.flow_version_id,
      type: row.type,
      key: row.key,
      name: row.name,
      configuration: row.configuration ?? {},
      position: row.position ?? { x: 0, y: 0 },
      metadata: row.metadata ?? {},
      isStart: row.is_start,
    })),
    transitions: (setas.data ?? []).map((row) => ({
      id: row.id,
      flowVersionId: row.flow_version_id,
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id,
      condition: row.condition,
      label: row.label,
      priority: row.priority,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* A validação — a do BANCO, que é a que vale                                 */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ CHAMA `validate_flow_version()` EM VEZ DE REIMPLEMENTAR AS REGRAS.
 *
 * Existe um espelho em TypeScript (`validateFlowGraph`), e ele serve para a tela
 * reagir sem ir ao servidor. Este aqui é o que a tela mostra ANTES de publicar,
 * e a razão de existir é a mesma de `searchKnowledge` chamar `search_knowledge`:
 * a prévia precisa responder o mesmo que a barreira vai responder. Duas
 * implementações da mesma regra divergem no dia em que a regra mudar.
 */
export async function validateFlowVersion(versionId: string): Promise<FlowValidationIssue[]> {
  const supabase = await createClient();

  const { data, error } = await untyped(supabase).rpc("validate_flow_version", {
    p_version_id: versionId,
  });

  if (error) {
    console.error(`[flows] validateFlowVersion falhou: ${error.message}`);
    throw error;
  }

  // `returns table (code text, detail text)` chega como lista. O cast é o preço
  // do cliente sem tipos — ver `src/lib/supabase/untyped.ts`.
  return (data ?? []) as FlowValidationIssue[];
}

/* -------------------------------------------------------------------------- */
/* Times de atendimento                                                       */
/* -------------------------------------------------------------------------- */

interface TeamRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: AttendanceTeam["status"];
  created_at: string;
  updated_at: string;
  members: { profile_id: string }[] | null;
}

/** A mesma linha, com os membros por extenso — a ficha, não a lista. */
interface TeamDetailRow extends Omit<TeamRow, "members"> {
  members:
    | {
        profile_id: string;
        added_at: string;
        profile: { id: string; full_name: string | null; email: string | null } | null;
      }[]
    | null;
}

export async function listAttendanceTeams(): Promise<AttendanceTeam[]> {
  const supabase = await createClient();

  const { data, error } = await untyped(supabase)
    .from("attendance_teams")
    .select(
      "id, key, name, description, status, created_at, updated_at, " +
        "members:attendance_team_members (profile_id)",
    )
    .order("name")
    .returns<TeamRow[]>();

  if (error) {
    console.error(`[flows] listAttendanceTeams falhou: ${error.message}`);
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    memberCount: (row.members ?? []).length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getAttendanceTeam(id: string): Promise<AttendanceTeamDetail | null> {
  const supabase = await createClient();

  const { data, error } = await untyped(supabase)
    .from("attendance_teams")
    .select(
      "id, key, name, description, status, created_at, updated_at, " +
        "members:attendance_team_members (profile_id, added_at, profile:profiles (id, full_name, email))",
    )
    .eq("id", id)
    .returns<TeamDetailRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[flows] getAttendanceTeam falhou: ${error.message}`);
    throw error;
  }

  if (!data) return null;

  const membros = data.members ?? [];

  return {
    id: data.id,
    key: data.key,
    name: data.name,
    description: data.description,
    status: data.status,
    memberCount: membros.length,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    members: membros.map((m) => ({
      profileId: m.profile_id,
      fullName: m.profile?.full_name ?? null,
      email: m.profile?.email ?? null,
      addedAt: m.added_at,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Execuções                                                                  */
/* -------------------------------------------------------------------------- */

interface RunRow {
  id: string;
  flow_id: string;
  flow_version_id: string;
  whatsapp_chat_id: string | null;
  current_node_id: string | null;
  status: FlowRun["status"];
  conversation_status: FlowRun["conversationStatus"];
  variables: Record<string, string> | null;
  intent: string | null;
  intent_confidence: number | null;
  assigned_team_id: string | null;
  assigned_user_id: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  flow: { name: string } | null;
  version: { version: number } | null;
  team: { key: string } | null;
}

/**
 * As execuções de um fluxo — o histórico de quem passou por ele.
 *
 * ⚠️ NESTA FUNDAÇÃO A TABELA ESTÁ VAZIA, e vai continuar até o Prompt 4 ligar o
 * motor ao WhatsApp. A leitura existe agora porque o modelo tem de suportar o
 * §16 (o resumo para o atendente) desde já — e porque escrever a consulta junto
 * com o schema é quando se descobre que falta um índice.
 */
export async function listFlowRuns(flowId: string, limit = 50): Promise<FlowRun[]> {
  const supabase = await createClient();

  const { data, error } = await untyped(supabase)
    .from("flow_runs")
    .select(
      "id, flow_id, flow_version_id, whatsapp_chat_id, current_node_id, status, " +
        "conversation_status, variables, intent, intent_confidence, assigned_team_id, " +
        "assigned_user_id, started_at, updated_at, completed_at, " +
        "flow:flows (name), version:flow_versions (version), team:attendance_teams (key)",
    )
    .eq("flow_id", flowId)
    .order("started_at", { ascending: false })
    .limit(limit)
    .returns<RunRow[]>();

  if (error) {
    console.error(`[flows] listFlowRuns falhou: ${error.message}`);
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    flowId: row.flow_id,
    flowName: row.flow?.name ?? "—",
    flowVersionId: row.flow_version_id,
    flowVersionNumber: row.version?.version ?? 0,
    whatsappChatId: row.whatsapp_chat_id,
    currentNodeId: row.current_node_id,
    status: row.status,
    conversationStatus: row.conversation_status,
    variables: row.variables ?? {},
    intent: row.intent,
    intentConfidence: row.intent_confidence,
    assignedTeamId: row.assigned_team_id,
    assignedTeamKey: row.team?.key ?? null,
    assignedUserId: row.assigned_user_id,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }));
}
