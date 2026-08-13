import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  IMAGE_SIGNED_URL_TTL_SECONDS,
  MARKET_BUCKET,
  PDF_SIGNED_URL_TTL_SECONDS,
} from "@/lib/market/storage";
import type { MarketBulletinChatbotView } from "@/modules/market/market.types";

/**
 * A PORTA DO CHATBOT PARA A BOLSA.
 *
 * A regra oficial de disponibilidade, e nenhuma condição a menos:
 *
 *   1. a Bolsa permite consumo por robô  (`chatbot_enabled = true`)
 *   2. a publicação é a ATIVA            (`status = 'active'`)
 *   3. a vigência já chegou              (`effective_date <= hoje`)
 *
 * ⚠️ `null` NÃO SIGNIFICA "USE A ANTERIOR". Significa que não há boletim oficial
 * disponível agora, e o atendimento deve ser encaminhado para uma pessoa. Não
 * existe caminho nesta função que devolva a versão histórica quando a atual não
 * serve: um boletim de PREÇO desatualizado citado como se fosse o vigente é pior
 * do que "não tenho essa informação agora".
 *
 * ⚠️ AINDA NÃO ESTÁ LIGADA AO MOTOR DO CHAT, e isso é deliberado: hoje todo texto
 * do bot sai do catálogo aprovado em `csp.content.ts`, sem etapa de consulta.
 * Quando essa etapa existir, ela roda ANÔNIMA — `/api/chat` é público e a RLS de
 * `market_bulletins` exige papel autenticado —, então precisará de um cliente
 * `service_role` no servidor e tem de entrar por AQUI. Uma segunda consulta em
 * outro lugar é como as duas entradas divergem no dia em que a regra mudar.
 */

/** Só o que o chatbot precisa. O resto da linha nunca sai do servidor. */
const CHATBOT_COLUMNS =
  "id, version_name, effective_date, image_path, pdf_path, " +
  "bulletin:market_bulletins!inner (id, name, chatbot_enabled)";

interface ChatbotRow {
  id: string;
  version_name: string;
  effective_date: string;
  image_path: string;
  pdf_path: string;
  bulletin: { id: string; name: string; chatbot_enabled: boolean };
}

/**
 * O "hoje" oficial, apurado pelo BANCO.
 *
 * A mesma função que a migration usa para carimbar o nome da publicação. Deixar
 * o corte para o relógio do servidor Node significaria, das 21h à meia-noite,
 * considerar vigente no fuso de São Paulo algo que só passa a valer amanhã.
 *
 * O nome `event_today` é histórico — a função nasceu em Eventos e é o "hoje" de
 * toda a plataforma. Está registrado em docs/BOLSA.md como renomeação pendente;
 * duplicá-la só para ter um nome bonito criaria duas verdades sobre que dia é
 * hoje, que é exatamente o problema que ela existe para resolver.
 */
async function businessToday(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("event_today");

  if (error) {
    console.error(`[market-chatbot] event_today falhou: ${error.message}`);
    return null;
  }

  return data as unknown as string;
}

async function toView(row: ChatbotRow): Promise<MarketBulletinChatbotView | null> {
  const supabase = await createClient();

  const [image, pdf] = await Promise.all([
    supabase.storage
      .from(MARKET_BUCKET)
      .createSignedUrl(row.image_path, IMAGE_SIGNED_URL_TTL_SECONDS),
    supabase.storage.from(MARKET_BUCKET).createSignedUrl(row.pdf_path, PDF_SIGNED_URL_TTL_SECONDS),
  ]);

  // Sem os DOIS arquivos acessíveis, a publicação não é entregável. Devolver
  // meia resposta faria o bot mandar uma imagem sem o boletim, ou o contrário.
  if (!image.data || !pdf.data) {
    console.error(
      `[market-chatbot] URL assinada falhou: ${image.error?.message ?? pdf.error?.message ?? "sem dados"}`,
    );
    return null;
  }

  return {
    bulletinId: row.bulletin.id,
    name: row.bulletin.name,
    versionName: row.version_name,
    effectiveDate: row.effective_date,
    imageUrl: image.data.signedUrl,
    pdfUrl: pdf.data.signedUrl,
  };
}

/**
 * O boletim oficial de uma Bolsa, ou `null` se não houver um disponível.
 *
 * As três condições viram filtro de SQL. O `!inner` no embed é o que faz
 * `chatbot_enabled = false` eliminar a linha em vez de devolvê-la com a Bolsa
 * anexada — a checagem acontece no banco, não num `if` que alguém pode remover.
 */
export async function getBulletinForChatbot(
  bulletinId: string,
): Promise<MarketBulletinChatbotView | null> {
  const today = await businessToday();
  if (!today) return null;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("market_bulletin_versions")
    .select(CHATBOT_COLUMNS)
    .eq("bulletin_id", bulletinId)
    .eq("status", "active")
    .lte("effective_date", today)
    // ⚠️ O APELIDO do embed (`bulletin:market_bulletins!inner`), não o nome da
    // tabela: o PostgREST resolve filtro sobre recurso embutido pelo apelido. E
    // é o `!inner` que faz a condição ELIMINAR a linha em vez de só anexar a
    // Bolsa — sem ele, uma Bolsa desligada ainda devolveria a publicação.
    .eq("bulletin.chatbot_enabled", true)
    .returns<ChatbotRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`[market-chatbot] getBulletinForChatbot falhou: ${error.message}`);
    throw error;
  }
  if (!data) return null;

  return toView(data);
}

/**
 * A mesma porta, procurando pelo NOME.
 *
 * Existe porque o chatbot vai perguntar por "Bolsa de Suínos", não por uuid —
 * ele não conhece (nem deve conhecer) os ids do banco.
 *
 * A comparação ignora caixa pelo mesmo motivo do índice
 * `market_bulletins_name_key`: "bolsa de suínos" e "Bolsa de Suínos" são a mesma
 * Bolsa, e a unicidade por nome garante que a busca não fique ambígua.
 */
export async function getBulletinForChatbotByName(
  name: string,
): Promise<MarketBulletinChatbotView | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("market_bulletins")
    .select("id")
    .ilike("name", name.trim())
    .returns<{ id: string }[]>()
    .maybeSingle();

  if (error) {
    console.error(`[market-chatbot] getBulletinForChatbotByName falhou: ${error.message}`);
    throw error;
  }
  if (!data) return null;

  return getBulletinForChatbot(data.id);
}
