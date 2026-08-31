import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { SETTING_KEYS } from "@/modules/admin/admin.labels";

/**
 * §83. A CHAVE GERAL DO ROBÔ.
 *
 * ⚠️ POR QUE ELA EXISTE, EM UMA FRASE: no dia em que o robô disser algo errado,
 * a diferença entre desligá-lo em cinco minutos e em meia hora é ter isto ou
 * ter de fazer um deploy. É a única bandeira deste módulo, e ela é de verdade —
 * está ligada ao caminho de execução, não é um enfeite de arquitetura.
 *
 * ⚠️ E POR QUE SÓ UMA. O §83 sugere quatro (`chatbot_intelligence_enabled`,
 * `ai_enabled`, `rag_enabled`, `human_handoff_enabled`). Três delas descreveriam
 * estados que este sistema não tem:
 *
 *   `ai_enabled`            desligar a IA sem desligar o robô é o §46, e ele já
 *                           acontece sozinho quando o modelo falha — uma
 *                           bandeira para forçá-lo seria um segundo caminho para
 *                           o mesmo lugar;
 *   `rag_enabled`           não há RAG a ligar (ver docs/INTELIGENCIA.md);
 *   `human_handoff_enabled` desligar o encaminhamento humano deixaria a pessoa
 *                           que pede uma pessoa sem nenhuma saída. Não é uma
 *                           opção que alguém deva ter.
 *
 * Bandeira que não faz nada é pior que bandeira nenhuma: ela é lida como
 * proteção existente. Uma que funciona vale mais que quatro que enfeitam.
 */

/**
 * O valor exato que desliga. Qualquer outra coisa mantém ligado.
 *
 * ⚠️ FALHA-ABERTO, E A ESCOLHA TEM LADO. Um valor incompreensível ("desligado",
 * "false", vazio) mantém o robô ligado, e a razão é a assimetria dos sintomas:
 * um robô que deveria estar mudo e responde é visível na hora (alguém lê a
 * resposta); um robô que deveria responder e ficou mudo por um erro de
 * digitação é invisível — ninguém percebe uma mensagem que não chegou.
 *
 * O texto de ajuda na tela diz exatamente o que escrever.
 */
const VALOR_DESLIGADO = "off";

/**
 * O robô pode responder no WhatsApp agora?
 *
 * ⚠️ FALHA VIRA `true`. Uma consulta de configuração que não respondeu não é
 * motivo para derrubar o atendimento — é o mesmo raciocínio do parágrafo acima,
 * aplicado à indisponibilidade em vez de ao erro de digitação.
 */
export async function chatbotEnabled(): Promise<boolean> {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", SETTING_KEYS.chatbotEnabled)
      // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
      .returns<{ value: string }[]>()
      .maybeSingle();

    if (error) throw error;

    // Linha ausente = ligado. A ausência da configuração precisa significar o
    // comportamento de antes de ela existir.
    return (data?.value ?? "").trim().toLowerCase() !== VALOR_DESLIGADO;
  } catch (erro) {
    console.error(
      `[intelligence.flags] leitura de ${SETTING_KEYS.chatbotEnabled} falhou; mantendo ligado`,
      { motivo: erro instanceof Error ? erro.message : String(erro) },
    );
    return true;
  }
}
