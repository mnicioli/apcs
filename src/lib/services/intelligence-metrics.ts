import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  IntelligenceDailyMetrics,
  IntelligenceIntentTotal,
  UnknownQuestion,
} from "@/modules/intelligence/metrics.types";

/**
 * §34 a §37, §76. AS MÉTRICAS DO ROBÔ.
 *
 * ⚠️ CLIENTE DO USUÁRIO, E NÃO `service_role` — ao contrário de todo o resto
 * deste módulo. Aqui quem lê é uma PESSOA no CRM, não o robô: as views são
 * `security_invoker`, então a RLS de `intelligence_interactions` (só
 * `is_admin()`) decide, e ninguém precisa escrever uma checagem de permissão
 * que possa ser esquecida.
 *
 * É a mesma razão pela qual `whatsapp.ts` usa o cliente do usuário e
 * `whatsapp-bot.ts` usa o `service_role`: consumidores diferentes, portas
 * diferentes.
 *
 * ⚠️ E ELAS DEVOLVEM VAZIO EM VEZ DE LANÇAR. Um painel de acompanhamento não
 * pode derrubar a tela de configuração — quem entrou ali provavelmente entrou
 * para editar uma frase, e perder isso por causa de um gráfico seria absurdo.
 */

/** Janela do painel. Trinta dias é o que responde "como foi o mês". */
const DIAS = 30;

/** Quantas perguntas sem resposta a tela mostra de uma vez. */
const MAX_PERGUNTAS = 25;

export async function getIntelligenceDailyMetrics(): Promise<IntelligenceDailyMetrics[]> {
  try {
    const supabase = await createClient();
    const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("intelligence_daily_metrics")
      .select("*")
      .gte("dia", desde)
      .order("dia", { ascending: false })
      // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
      .returns<IntelligenceDailyMetrics[]>();

    if (error) throw error;
    return data ?? [];
  } catch (erro) {
    console.error(`[intelligence-metrics] diário falhou: ${String(erro)}`);
    return [];
  }
}

export async function getIntelligenceIntentTotals(): Promise<IntelligenceIntentTotal[]> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("intelligence_intent_totals")
      .select("*")
      .order("turnos", { ascending: false })
      .returns<IntelligenceIntentTotal[]>();

    if (error) throw error;
    return data ?? [];
  } catch (erro) {
    console.error(`[intelligence-metrics] intenções falhou: ${String(erro)}`);
    return [];
  }
}

/**
 * §37. As perguntas que o robô não respondeu — a lista mais útil daqui.
 *
 * ⚠️ É ELA QUE VIRA ENTRADA NA BASE DE CONHECIMENTO. As outras duas dizem que
 * há um problema; esta diz QUAL, com as palavras que as pessoas usaram.
 *
 * O texto vem de `whatsapp_messages` (a trilha não o guarda, de propósito), e a
 * view exige as duas policies: `is_admin()` pela trilha e o papel de leitura do
 * WhatsApp pela mensagem. Quem vê isto já podia ver a conversa inteira.
 */
export async function getUnknownQuestions(): Promise<UnknownQuestion[]> {
  try {
    const supabase = await createClient();
    const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString();

    const { data, error } = await supabase
      .from("intelligence_unknown_questions")
      .select("id, created_at, whatsapp_chat_id, confidence, outcome, pergunta")
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(MAX_PERGUNTAS)
      .returns<UnknownQuestion[]>();

    if (error) throw error;
    return data ?? [];
  } catch (erro) {
    console.error(`[intelligence-metrics] perguntas falhou: ${String(erro)}`);
    return [];
  }
}
