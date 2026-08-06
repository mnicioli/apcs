import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeTurn, type LlmMeta } from "@/lib/chat/llm";
import {
  decideTurn,
  openingDecision,
  pendingOptions,
  type ConversationState,
  type TurnDecision,
  type TurnInput,
} from "@/lib/chat/decide";
import { classifyConsentReply, CONSENT_DECLINE_VALUE, CONSENT_OPTIONS } from "@/lib/chat/consent";
import { envOrFallback } from "@/lib/chat/env";
import {
  evaluateRateLimit,
  HISTORY_LIMIT,
  MAX_CONVERSATIONS_PER_IP_PER_HOUR,
} from "@/lib/chat/rate-limit";
import { generateSessionToken, hashSessionToken } from "@/lib/chat/session";
import { cspLeadDataSchema, parseStoredCollected } from "@/modules/chat/chat.schema";
import type {
  ChatMessage,
  ChatMessageRole,
  ChatOption,
  CspCollected,
} from "@/modules/chat/chat.types";
import {
  renderCspContent,
  type CspContentKey,
  type CspContentVars,
} from "@/modules/chat/flows/csp.content";
import { buildCspSummary } from "@/modules/chat/flows/csp.flow";
import { DEFAULT_FLOW_KEY } from "@/modules/chat/flows/registry";

/**
 * Motor do chat: orquestra banco → LLM → decisão → banco.
 *
 * A regra de ouro está em `decide.ts` (determinístico) e em `csp.content.ts`
 * (catálogo aprovado). Aqui só tem encanamento — nenhuma decisão de conversa.
 */

export interface ChatBotMessage {
  content: string;
  contentKey: CspContentKey;
}

export interface ChatTurnResponse {
  messages: ChatBotMessage[];
  options: ChatOption[];
  /** Conversa encerrada — o widget desabilita o input. */
  closed: boolean;
}

export interface ChatResumeResponse {
  messages: { role: ChatMessageRole; content: string }[];
  options: ChatOption[];
  closed: boolean;
}

function contentVars(collected: CspCollected): Partial<CspContentVars> {
  return {
    policyUrl: envOrFallback(
      process.env.APCS_PRIVACY_POLICY_URL,
      "(política de privacidade em breve)",
    ),
    materialUrl: envOrFallback(process.env.APCS_CSP_MATERIAL_URL, "(material em breve)"),
    // Único valor que carrega texto digitado pela pessoa. Seguro porque
    // `renderCspContent` substitui em passada única — ver o comentário lá.
    summary: buildCspSummary(collected),
  };
}

function renderDecision(decision: TurnDecision): ChatBotMessage[] {
  const vars = contentVars(decision.collected);
  return decision.contentKeys.map((contentKey) => ({
    contentKey,
    content: renderCspContent(contentKey, vars),
  }));
}

function approvedReply(contentKey: CspContentKey, options: ChatOption[], closed: boolean) {
  return {
    messages: [{ contentKey, content: renderCspContent(contentKey) }],
    options,
    closed,
  };
}

/**
 * Abre uma conversa nova e devolve o token de sessão (que o route handler grava
 * no cookie httpOnly) junto das mensagens de abertura.
 */
export async function startConversation(params: {
  ipHash: string | null;
  userAgent: string | null;
}): Promise<{ token: string; response: ChatTurnResponse }> {
  const admin = createAdminClient();
  const token = generateSessionToken();
  const decision = openingDecision();

  const { data, error } = await admin
    .from("chat_conversations")
    .insert({
      flow_key: DEFAULT_FLOW_KEY,
      session_token_hash: hashSessionToken(token),
      ip_hash: params.ipHash,
      user_agent: params.userAgent,
      collected: {},
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error(`[chat.engine] falha ao criar conversa: ${error?.message}`);
    throw error ?? new Error("Falha ao criar conversa.");
  }

  const messages = renderDecision(decision);
  await persistBotMessages(data.id, messages, null);

  return { token, response: { messages, options: decision.options, closed: false } };
}

/**
 * Impede que um único IP abra conversas em massa — cada conversa nova é uma
 * linha no banco e um convite a chamadas de LLM.
 */
export async function canStartConversation(ipHash: string | null): Promise<boolean> {
  if (!ipHash) return true;

  const admin = createAdminClient();
  const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();

  const { count, error } = await admin
    .from("chat_conversations")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", oneHourAgo);

  if (error) {
    console.error(`[chat.engine] falha ao contar conversas do IP: ${error.message}`);
    return true;
  }
  return (count ?? 0) < MAX_CONVERSATIONS_PER_IP_PER_HOUR;
}

/**
 * Retoma uma conversa a partir do cookie: devolve o histórico completo e as
 * opções da pergunta pendente. `null` = token sem conversa correspondente.
 */
export async function resumeConversation(token: string): Promise<ChatResumeResponse | null> {
  const state = await loadConversation(token);
  if (!state) return null;

  const history = await loadHistory(state.id);

  return {
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    options: pendingOptions(state),
    closed: state.status !== "active",
  };
}

/** Continua uma conversa existente. `null` = token não corresponde a nada. */
export async function handleUserMessage(params: {
  token: string;
  message: string;
  optionValue?: string;
}): Promise<ChatTurnResponse | null> {
  const admin = createAdminClient();
  const conversation = await loadConversation(params.token);
  if (!conversation) return null;

  // Conversa encerrada: responde e SAI, sem gravar nada. Sem este short-circuit,
  // uma conversa recusada continuaria acumulando as mensagens do visitante.
  if (conversation.status !== "active") {
    return approvedReply("conversationClosed", [], true);
  }

  // --- Limites do canal público ---------------------------------------------
  const verdict = evaluateRateLimit(await countUserMessages(conversation.id));
  if (!verdict.allowed) {
    if (verdict.reason === "exhausted") {
      // Marca no banco: senão a conversa fica `active` para sempre e o widget
      // "reabre" ela a cada recarregamento de página.
      await admin
        .from("chat_conversations")
        .update({ status: "abandoned" })
        .eq("id", conversation.id);
      return approvedReply("conversationClosed", [], true);
    }
    return approvedReply("rateLimited", pendingOptions(conversation), false);
  }

  const consentReply = classifyConsentReply({
    message: params.message,
    optionValue: params.optionValue,
  });

  // ---------------------------------------------------------------------------
  // ANTES DO CONSENTIMENTO: nada sai do servidor e nada de texto cru entra no
  // banco. A classificação é determinística (ver `consent.ts`) — o LLM nem é
  // chamado, porque não há base legal para mandar o texto (que pode conter nome
  // e telefone) para um processador terceiro.
  // ---------------------------------------------------------------------------
  if (!conversation.consentGiven) {
    if (consentReply !== "unclear") {
      // Registra o ATO de consentimento (não o texto livre da pessoa): é a
      // evidência auditável de que houve manifestação afirmativa.
      const label = CONSENT_OPTIONS.find((o) =>
        consentReply === "accept" ? o.value === "accept" : o.value === CONSENT_DECLINE_VALUE,
      )?.label;
      await persistUserMessage(conversation.id, label ?? consentReply, {
        source: params.optionValue ? "button" : "text",
      });
    }

    return await applyDecision(
      conversation,
      decideTurn(conversation, { kind: "consent", reply: consentReply }),
      null,
    );
  }

  // ---------------------------------------------------------------------------
  // COM CONSENTIMENTO: o turno normal.
  // ---------------------------------------------------------------------------
  // Histórico ANTES de gravar a mensagem atual — senão ela entraria duas vezes
  // no contexto do LLM (uma pelo histórico, outra como turno atual).
  const history = await loadHistory(conversation.id);
  await persistUserMessage(conversation.id, params.message, null);

  let turn: TurnInput;
  let meta: LlmMeta | null = null;

  if (params.optionValue === CONSENT_DECLINE_VALUE) {
    // Revogação por clique — não precisa do modelo.
    turn = { kind: "consent", reply: "decline" };
  } else {
    const result = await analyzeTurn({
      history,
      userMessage: params.message,
      collected: conversation.collected,
      consentGiven: true,
    });
    if (result.ok) {
      turn = { kind: "analysis", analysis: result.analysis };
      meta = result.meta;
    } else {
      turn = { kind: "unavailable" };
    }
  }

  return await applyDecision(conversation, decideTurn(conversation, turn), meta);
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

interface LoadedConversation extends ConversationState {
  id: string;
}

async function loadConversation(token: string): Promise<LoadedConversation | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("chat_conversations")
    .select("id, status, consent_given_at, collected")
    .eq("session_token_hash", hashSessionToken(token))
    .maybeSingle();

  if (error) {
    console.error(`[chat.engine] falha ao carregar conversa: ${error.message}`);
    throw error;
  }
  if (!data) return null;

  return {
    id: data.id,
    status: data.status,
    consentGiven: data.consent_given_at !== null,
    collected: parseStoredCollected(data.collected),
  };
}

/**
 * Grava o resultado do turno: mensagens do bot, estado da conversa e — quando a
 * triagem fecha — o lead. O lead vem PRIMEIRO: marcar a conversa como concluída
 * antes de gravá-lo faria um erro de banco perder o lead em silêncio.
 */
async function applyDecision(
  conversation: LoadedConversation,
  decision: TurnDecision,
  meta: LlmMeta | null,
): Promise<ChatTurnResponse> {
  const messages = renderDecision(decision);
  await persistBotMessages(conversation.id, messages, meta);

  let status = decision.status;
  if (decision.createLead) {
    const created = await createLead(conversation.id, decision.collected);
    if (!created) {
      // Não dá para "descompletar" a conversa (a pessoa já viu a confirmação),
      // mas dá para sinalizar que alguém precisa olhar isso na mão.
      status = "handoff";
    }
  }

  await persistConversationState(conversation, { ...decision, status });

  return {
    messages,
    options: decision.options,
    closed: status !== "active",
  };
}

async function countUserMessages(conversationId: string) {
  const admin = createAdminClient();
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();

  const [recent, total] = await Promise.all([
    admin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("role", "user")
      .gte("created_at", oneMinuteAgo),
    admin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId)
      .eq("role", "user"),
  ]);

  return {
    recentUserMessages: recent.count ?? 0,
    totalUserMessages: total.count ?? 0,
  };
}

async function loadHistory(conversationId: string): Promise<ChatMessage[]> {
  const admin = createAdminClient();

  // Ordena por `seq`, não por `created_at`: as várias mensagens que o bot grava
  // num único insert compartilham o timestamp da transação.
  const { data, error } = await admin
    .from("chat_messages")
    .select("id, role, content, content_key, created_at")
    .eq("conversation_id", conversationId)
    .order("seq", { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) {
    console.error(`[chat.engine] falha ao carregar histórico: ${error.message}`);
    return [];
  }

  return (data ?? []).reverse().map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    contentKey: row.content_key,
    createdAt: row.created_at,
  }));
}

async function persistUserMessage(
  conversationId: string,
  content: string,
  meta: Record<string, string> | null,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("chat_messages").insert({
    conversation_id: conversationId,
    role: "user",
    content,
    llm_meta: meta,
  });
  if (error) {
    console.error(`[chat.engine] falha ao gravar mensagem do visitante: ${error.message}`);
  }
}

async function persistBotMessages(
  conversationId: string,
  messages: ChatBotMessage[],
  meta: LlmMeta | null,
): Promise<void> {
  if (messages.length === 0) return;
  const admin = createAdminClient();

  const { error } = await admin.from("chat_messages").insert(
    messages.map((message, index) => ({
      conversation_id: conversationId,
      role: "bot" as const,
      content: message.content,
      content_key: message.contentKey,
      // A telemetria do LLM fica só na primeira mensagem do turno.
      llm_meta: index === 0 && meta ? { ...meta } : null,
    })),
  );

  if (error) console.error(`[chat.engine] falha ao gravar mensagens: ${error.message}`);
}

async function persistConversationState(
  conversation: LoadedConversation,
  decision: TurnDecision,
): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("chat_conversations")
    .update({
      collected: { ...decision.collected },
      status: decision.status,
      last_message_at: new Date().toISOString(),
      // Só carimba na transição — não sobrescreve o consentimento original.
      ...(decision.consentGiven && !conversation.consentGiven
        ? {
            consent_given_at: new Date().toISOString(),
            consent_policy_version: envOrFallback(process.env.APCS_PRIVACY_POLICY_VERSION, "1"),
          }
        : {}),
    })
    .eq("id", conversation.id);

  if (error) console.error(`[chat.engine] falha ao atualizar conversa: ${error.message}`);
}

/** `true` se o lead foi realmente gravado. */
async function createLead(conversationId: string, collected: CspCollected): Promise<boolean> {
  const parsed = cspLeadDataSchema.safeParse(collected);
  if (!parsed.success) {
    // Não deveria acontecer: a triagem só fecha com todos os campos válidos.
    console.error(
      `[chat.engine] triagem completa mas inválida (${conversationId}): ${parsed.error.issues[0]?.path.join(".")}`,
    );
    return false;
  }

  const admin = createAdminClient();
  const lead = parsed.data;

  const { data: contact, error: contactError } = await admin
    .from("chat_contacts")
    .insert({
      full_name: lead.fullName,
      city: lead.city,
      state: lead.state,
      contact_profile: lead.contactProfile,
      phone: lead.phone ?? null,
      email: lead.email ?? null,
      preferred_channel: lead.preferredChannel,
      preferred_time: lead.preferredTime ?? null,
    })
    .select("id")
    .single();

  if (contactError || !contact) {
    console.error(`[chat.engine] falha ao criar contato: ${contactError?.message}`);
    return false;
  }

  await admin
    .from("chat_conversations")
    .update({ contact_id: contact.id })
    .eq("id", conversationId);

  const { error: leadError } = await admin.from("csp_leads").insert({
    conversation_id: conversationId,
    contact_id: contact.id,
    full_name: lead.fullName,
    city: lead.city,
    state: lead.state,
    contact_profile: lead.contactProfile,
    interest: lead.interest,
    volume_range: lead.volumeRange ?? null,
    preferred_channel: lead.preferredChannel,
    preferred_time: lead.preferredTime ?? null,
    phone: lead.phone ?? null,
    email: lead.email ?? null,
  });

  if (leadError) {
    console.error(`[chat.engine] falha ao criar lead: ${leadError.message}`);
    return false;
  }
  return true;
}
