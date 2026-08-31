import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { SETTING_FALLBACKS } from "@/lib/services/admin";
import { SETTING_KEYS, type SettingKey } from "@/modules/admin/admin.labels";
import type { ChatbotMessageKey } from "@/modules/intelligence/intelligence.types";

/**
 * AS FRASES QUE O ROBÔ DIZ — lidas de `app_settings`, nunca escritas em código.
 *
 * ⚠️ O ROTEADOR DEVOLVE UMA CHAVE, E ESTE ARQUIVO A RESOLVE. É a fronteira que
 * faz o §2 valer: `router.ts` é puro e não tem como produzir uma frase, e este
 * arquivo não tem como produzir uma frase que a APCS não escreveu — ele só sabe
 * ler uma linha da tabela ou cair no padrão do código.
 *
 * ⚠️ CLIENTE `service_role` porque quem lê é o robô, que é anônimo — e
 * `app_settings` tem RLS. Sem isso, TODA frase cairia no padrão do código, e a
 * tela de Configurações passaria a não ter efeito nenhum sem ninguém perceber
 * (as frases padrão são iguais às do seed, então nada pareceria errado até
 * alguém editá-las).
 */

/**
 * A ponte entre o vocabulário do roteador e as chaves da configuração.
 *
 * `Record` completo: uma mensagem nova em `CHATBOT_MESSAGES` faz o TypeScript
 * apontar esta linha, em vez de deixar um caminho sem texto.
 */
const CHAVES: Record<ChatbotMessageKey, SettingKey> = {
  welcome: SETTING_KEYS.chatbotWelcome,
  fallback: SETTING_KEYS.chatbotFallback,
  noResult: SETTING_KEYS.chatbotNoResult,
  error: SETTING_KEYS.chatbotError,
  humanHandoff: SETTING_KEYS.chatbotHumanHandoff,
  unidentified: SETTING_KEYS.chatbotUnidentified,
  menu: SETTING_KEYS.chatbotMenu,
  closing: SETTING_KEYS.chatbotClosing,
};

/**
 * ⚠️ UMA CONSULTA POR TURNO, e não uma por frase. Um turno usa no máximo duas
 * mensagens (a resposta e, quando é encaminhamento, a confirmação) — buscar
 * chave por chave seria ir ao banco duas vezes para ler duas linhas da mesma
 * tabela minúscula.
 */
export type ChatbotMessages = (key: ChatbotMessageKey) => string;

export async function loadChatbotMessages(): Promise<ChatbotMessages> {
  let gravadas = new Map<string, string>();

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("app_settings")
      .select("key, value")
      .like("key", "chatbot.%")
      // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
      .returns<{ key: string; value: string }[]>();

    if (error) throw error;
    gravadas = new Map((data ?? []).map((linha) => [linha.key, linha.value]));
  } catch (erro) {
    // ⚠️ FALHA AQUI NÃO CALA O ROBÔ. O padrão do código é a rede de segurança
    // (`SETTING_FALLBACKS`), e um bot sem frase não fica em silêncio: fica
    // mandando string vazia, que o WhatsApp nem chega a entregar — a pessoa vê
    // a própria pergunta e nenhuma resposta.
    console.error(
      `[intelligence.messages] leitura falhou, usando os padrões do código: ${
        erro instanceof Error ? erro.message : String(erro)
      }`,
    );
  }

  return (key) => {
    const chave = CHAVES[key];
    return gravadas.get(chave)?.trim() || SETTING_FALLBACKS[chave];
  };
}
