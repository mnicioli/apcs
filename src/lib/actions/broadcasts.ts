"use server";

import { revalidatePath } from "next/cache";
import { fail, failFromPostgres, ok, type ActionResult } from "@/lib/actions/errors";
import { assertPermission } from "@/lib/auth/assert-permission";
import { createClient } from "@/lib/supabase/server";
import {
  canBroadcastLecture,
  getBroadcastAudience,
  resolveBroadcastSubject,
} from "@/lib/services/broadcasts";
import { broadcastWhatsAppMessage } from "@/modules/broadcast/broadcast.labels";
import {
  audienceSizeSchema,
  resumeBroadcastSchema,
  startBroadcastSchema,
  type AudienceSizeInput,
  type ResumeBroadcastInput,
  type StartBroadcastInput,
} from "@/modules/broadcast/broadcast.schema";
import type { BroadcastAudience, BroadcastSource } from "@/modules/broadcast/broadcast.types";
import type { Permission } from "@/lib/rbac/rbac.types";

/**
 * ACTION = escrita. SEMPRE devolve `ActionResult`, NUNCA lança.
 *
 * ⚠️ A PERMISSÃO É A DO MÓDULO DE ORIGEM, e não uma "permissão de divulgar".
 * Quem pode publicar uma normativa pode anunciá-la; quem não pode publicar não
 * deveria poder mandar uma mensagem para toda a base sobre ela. Hoje as três
 * chaves têm a mesma lista (admin e ceo), mas escrever assim é o que faz a
 * divergência futura funcionar sozinha — em vez de virar um buraco descoberto
 * depois de alguém divulgar o que não podia.
 */
const PERMISSAO_POR_ORIGEM: Record<BroadcastSource, Permission> = {
  normative: "documents.write",
  communication: "documents.write",
  market_bulletin: "market.write",
  lecture: "lectures.write",
};

/**
 * ⚠️ INVALIDA OS PADRÕES DE ROTA DOS QUATRO MÓDULOS, e não só o da origem.
 *
 * Poderia ser mais preciso, e o ganho seria zero: são telas de backoffice, com
 * poucos acessos, e a alternativa é um mapa origem → rotas que alguém esquece
 * de atualizar quando um módulo novo entrar. O erro caro aqui é invalidar de
 * MENOS — a tela continuaria dizendo "nunca divulgado" depois do envio.
 */
function revalidarOrigem(): void {
  revalidatePath("/documents/[category]", "page");
  revalidatePath("/documents/[category]/[id]", "page");
  revalidatePath("/market", "page");
  revalidatePath("/market/[id]", "page");
  revalidatePath("/lectures", "page");
  revalidatePath("/lectures/[id]", "page");
}

/**
 * DISPARA A DIVULGAÇÃO.
 *
 * ⚠️ A MENSAGEM É COMPOSTA AQUI, LENDO O REGISTRO — a tela manda só ids. Ver o
 * cabeçalho de `broadcast.schema.ts`: um campo de texto livre transformaria
 * isto num disparador de mensagem arbitrária para toda a base, assinado pelo
 * número da APCS.
 *
 * ⚠️ A ORDEM É FILA PRIMEIRO, ENVIO DEPOIS, e as duas metades correm com
 * identidades diferentes:
 *
 *   1. `start_broadcast` roda com a SESSÃO DE QUEM CLICOU. É lá que o papel é
 *      conferido e a fotografia do público é tirada.
 *   2. `drainBroadcastQueue` roda com `service_role`, onde não há papel nenhum.
 *
 * Se a segunda metade for interrompida (orçamento de tempo, plataforma
 * matando a função), a fila continua e a tela oferece "Continuar" — a
 * divulgação não se perde.
 */
export async function startBroadcastAction(
  input: StartBroadcastInput,
): Promise<ActionResult<{ broadcastId: string; queued: number; blocked: number; sent: number }>> {
  type Iniciada = { broadcastId: string; queued: number; blocked: number; sent: number };

  const parsed = startBroadcastSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const { source, sourceId, segmentIds } = parsed.data;

  const negado = await assertPermission<Iniciada>(PERMISSAO_POR_ORIGEM[source]);
  if (negado) return negado;

  try {
    const alvo = await resolveBroadcastSubject(source, sourceId);
    if (!alvo) return fail("notFound");

    // ⚠️ A REGRA DE ESTADO DA PALESTRA MORA AQUI, e não no banco, porque é a
    // única específica de um módulo. Pôr um `case` por origem dentro de
    // `start_broadcast` faria a função genérica passar a conhecer palestras.
    if (alvo.subject.source === "lecture") {
      const { data } = await (await createClient())
        .from("lectures")
        .select("status")
        .eq("id", sourceId)
        .maybeSingle<{ status: string }>();

      if (!data || !canBroadcastLecture(data.status)) return fail("broadcastNotReady");
    }

    const mensagem = broadcastWhatsAppMessage(alvo.subject);

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("start_broadcast", {
      p_source: source,
      p_source_id: sourceId,
      p_title: alvo.subject.title,
      p_body: mensagem,
      p_segment_ids: segmentIds,
      p_media_bucket: alvo.media?.bucket ?? null,
      p_media_path: alvo.media?.path ?? null,
      p_media_mime: alvo.media?.mime ?? null,
      p_media_filename: alvo.media?.filename ?? null,
    } as never);

    if (error) return failFromPostgres("broadcast.start", error, { source, sourceId, segmentIds });

    const linha = (data as { broadcast_id: string; queued: number; blocked: number }[] | null)?.[0];
    if (!linha?.broadcast_id) {
      // ⚠️ Não deveria acontecer — `start_broadcast` sempre devolve uma linha ou
      // levanta exceção. Mas "não deveria acontecer" sem log é como uma falha
      // some sem deixar rastro: se um dia a assinatura da função mudar e ela
      // passar a devolver outra forma, é esta linha que vai dizer isso.
      console.error("[broadcast.start] a função não devolveu a divulgação criada:", {
        source,
        sourceId,
        recebido: data,
      });
      return fail("unexpected");
    }

    let enviadas = 0;
    if (linha.queued > 0) {
      // Import dinâmico: o worker arrasta o cliente `service_role` e a porta de
      // mensageria, e nada disso precisa ser carregado por quem só abriu a tela.
      const { drainBroadcastQueue } = await import("@/lib/services/broadcast-dispatch");
      const corrida = await drainBroadcastQueue(linha.broadcast_id);
      enviadas = corrida.sent;
    }

    revalidarOrigem();

    return ok({
      broadcastId: linha.broadcast_id,
      queued: linha.queued,
      blocked: linha.blocked,
      sent: enviadas,
    });
  } catch (erro) {
    console.error("[broadcast.start] erro inesperado:", erro);
    return fail("unexpected");
  }
}

/**
 * Continua uma divulgação que parou no orçamento de tempo.
 *
 * ⚠️ NÃO REABRE A FOTOGRAFIA. Quem entrou na base depois do clique original
 * não entra na fila — a divulgação é daquele momento, e um "continuar" que
 * ampliasse o público faria o número na tela mudar sozinho entre um clique e
 * outro.
 */
export async function resumeBroadcastAction(
  input: ResumeBroadcastInput,
): Promise<ActionResult<{ sent: number; remaining: number }>> {
  const parsed = resumeBroadcastSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  try {
    const supabase = await createClient();

    // A leitura passa pela RLS de `broadcasts`, e a permissão conferida é a do
    // módulo de origem — a mesma que autorizou o disparo.
    const { data: campanha, error: leituraError } = await supabase
      .from("broadcasts")
      .select("source, source_id")
      .eq("id", parsed.data.broadcastId)
      .maybeSingle<{ source: BroadcastSource; source_id: string }>();

    // ⚠️ FALHA DE LEITURA NÃO É "NÃO ENCONTRADO". O erro estava sendo
    // descartado, então uma consulta que quebrasse (RLS, coluna renomeada)
    // aparecia na tela como "registro não encontrado" — mandando a pessoa
    // procurar uma divulgação que está lá.
    if (leituraError) {
      return failFromPostgres("broadcast.resume", leituraError, {
        broadcastId: parsed.data.broadcastId,
      });
    }
    if (!campanha) return fail("notFound");

    const negado = await assertPermission<{ sent: number; remaining: number }>(
      PERMISSAO_POR_ORIGEM[campanha.source],
    );
    if (negado) return negado;

    const { drainBroadcastQueue } = await import("@/lib/services/broadcast-dispatch");
    const corrida = await drainBroadcastQueue(parsed.data.broadcastId);

    revalidarOrigem();

    return ok({ sent: corrida.sent, remaining: corrida.remainingCount });
  } catch (erro) {
    console.error("[broadcast.resume] erro inesperado:", erro);
    return fail("unexpected");
  }
}

/**
 * O alcance dos públicos escolhidos, para a tela mostrar ANTES do clique.
 *
 * ⚠️ É UMA ACTION, e não uma leitura no servidor da página, porque o número
 * muda a cada caixinha marcada — e recarregar a página inteira a cada clique
 * numa lista de seis públicos seria seis viagens completas.
 */
export async function broadcastAudienceAction(
  input: AudienceSizeInput,
): Promise<ActionResult<BroadcastAudience>> {
  const parsed = audienceSizeSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  // Qualquer uma das três serve: `broadcast_audience_size` no banco confere
  // `broadcast_is_writer()` de novo, e é ela quem decide.
  const negado = await assertPermission<BroadcastAudience>("documents.write");
  if (negado) return negado;

  try {
    return ok(await getBroadcastAudience(parsed.data.segmentIds));
  } catch (erro) {
    console.error("[broadcast.audience] erro inesperado:", erro);
    return fail("unexpected");
  }
}
