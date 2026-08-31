import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHATBOT_SIGNED_URL_TTL_SECONDS, MARKET_BUCKET } from "@/lib/market/storage";
import { prepareNameLookup } from "@/modules/intelligence/lookup";
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
 * ⚠️ CLIENTE `service_role`, E É OBRIGATÓRIO — não é atalho.
 *
 * Quem chama esta porta é o robô, que é ANÔNIMO: não há `auth.uid()`, não há
 * papel, e a RLS de `market_bulletins` exige papel autenticado. Com o cliente
 * do usuário (`@/lib/supabase/server`), como este arquivo nasceu, TODA consulta
 * daqui volta vazia — e o sintoma seria o pior possível: o bot respondendo "não
 * há boletim disponível" com o boletim publicado e ativo na tela.
 *
 * O mesmo vale para as URLs assinadas: a policy do bucket `market` exige papel,
 * então assinar com o cliente anônimo falharia depois de a consulta ter dado
 * certo — meia resposta, que é o que `toView` já se recusa a devolver.
 *
 * ⚠️ O QUE AUTORIZA ISSO NÃO É ESTE COMENTÁRIO: é o fato de esta função só
 * conseguir LER, e só linhas que passam pelas três condições acima. Não existe
 * caminho aqui que escreva, nem parâmetro que relaxe o filtro. É o mesmo
 * desenho de `lecture-chatbot.ts` e `survey-chatbot.ts`, que já nasceram assim.
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
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("event_today");

  if (error) {
    console.error(`[market-chatbot] event_today falhou: ${error.message}`);
    return null;
  }

  return data as unknown as string;
}

async function toView(row: ChatbotRow): Promise<MarketBulletinChatbotView | null> {
  const supabase = createAdminClient();

  const [image, pdf] = await Promise.all([
    supabase.storage
      .from(MARKET_BUCKET)
      .createSignedUrl(row.image_path, CHATBOT_SIGNED_URL_TTL_SECONDS),
    supabase.storage
      .from(MARKET_BUCKET)
      .createSignedUrl(row.pdf_path, CHATBOT_SIGNED_URL_TTL_SECONDS),
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

  const supabase = createAdminClient();

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
 * As Bolsas que o robô PODE citar agora.
 *
 * ⚠️ NÃO É A LISTA DE BOLSAS — é a lista das que têm publicação entregável: as
 * três condições do cabeçalho, todas. O roteador usa isto para o caso mais
 * comum de todos, que é a pessoa escrever "me manda a bolsa" sem dizer qual.
 *
 * Com UMA disponível, não há ambiguidade e ela é a resposta. Com mais de uma, o
 * robô tem de perguntar — e é melhor perguntar do que mandar a errada.
 */
export async function listChatbotBulletins(): Promise<{ id: string; name: string }[]> {
  const today = await businessToday();
  if (!today) return [];

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("market_bulletin_versions")
    .select("bulletin:market_bulletins!inner (id, name, chatbot_enabled)")
    .eq("status", "active")
    .lte("effective_date", today)
    .eq("bulletin.chatbot_enabled", true)
    .returns<{ bulletin: { id: string; name: string } }[]>();

  if (error) {
    console.error(`[market-chatbot] listChatbotBulletins falhou: ${error.message}`);
    throw error;
  }

  return (data ?? [])
    .map((row) => ({ id: row.bulletin.id, name: row.bulletin.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
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
  // ⚠️ §61. Mesmo motivo de `getDocumentForChatbotByName`: o nome vem do texto
  // que o associado escreveu, e `%` no ILIKE casa com tudo. Ver `lookup.ts`.
  const termo = prepareNameLookup(name);
  if (!termo) return null;

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("market_bulletins")
    .select("id")
    .ilike("name", termo)
    .returns<{ id: string }[]>()
    .maybeSingle();

  if (error) {
    console.error(`[market-chatbot] getBulletinForChatbotByName falhou: ${error.message}`);
    throw error;
  }
  if (!data) return null;

  return getBulletinForChatbot(data.id);
}
