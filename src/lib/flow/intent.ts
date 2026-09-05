import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiProvider } from "@/lib/intelligence/ai/registry";
import { logFlowEngineEvent } from "@/lib/messaging/telemetry";
import { SETTING_KEYS } from "@/modules/admin/admin.labels";
import { SETTING_FALLBACKS } from "@/lib/services/admin";
import {
  readFlowIntent,
  unavailableFlowIntent,
  type FlowIntentReading,
} from "@/modules/flow/flow.intent";
import { isWithinBusinessHours, BUSINESS_HOURS_VARIABLE } from "@/modules/flow/flow.hours";
import type { ConfidenceThresholds } from "@/modules/intelligence/intent.types";
import type { FlowVariables } from "@/modules/flow/flow.types";

/**
 * A IA A SERVIÇO DO FLUXO (§12 a §16, §40 a §45 do Prompt 4).
 *
 * ⚠️ ELE NÃO CRIA UM SEGUNDO FORNECEDOR DE IA, e essa é a decisão principal
 * deste arquivo. `AIProvider` (lib/intelligence/ai/) já é a abstração que o §40
 * pede — `AIService → IntentResolver → Provider` —, já tem registro, já tem
 * `configured`, já tem saída estruturada e já tem a propriedade que mais
 * importa: NÃO EXISTE `generateResponse` nela. O modelo não tem, em lugar
 * nenhum do sistema, um caminho para escrever texto ao associado.
 *
 * Isso é o §42 (proteção contra alucinação) sendo uma propriedade dos TIPOS, e
 * não uma promessa em comentário. Criar aqui um segundo cliente de IA — "só
 * para o fluxo" — reabriria exatamente essa porta, e o §51 a fecha por escrito
 * ("não criar arquitetura paralela").
 *
 * O que este arquivo acrescenta são três coisas que a abstração não tinha
 * porque ninguém precisava:
 *
 *   1. os limites de confiança lidos da CONFIGURAÇÃO (§14), e não do código;
 *   2. a tradução de `IntentAnalysis` para VARIÁVEIS de fluxo (§13);
 *   3. o log próprio do §44, no vocabulário do motor.
 */

/* -------------------------------------------------------------------------- */
/* §14 — os limites, lidos da configuração                                    */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ UMA CONSULTA POR TURNO, e ela só acontece quando a pergunta pede
 * interpretação. Um fluxo de menu puro — o caso mais comum — nunca chega aqui,
 * e por isso não paga nem esta consulta nem a do modelo.
 *
 * ⚠️ E FALHA VIRA O PADRÃO DO CÓDIGO. Uma leitura de configuração que não
 * respondeu não é motivo para derrubar o atendimento; é o mesmo raciocínio de
 * `chatbotEnabled` e de `loadChatbotMessages`.
 */
export async function loadFlowConfidenceThresholds(): Promise<ConfidenceThresholds> {
  const padrao: ConfidenceThresholds = {
    high: Number(SETTING_FALLBACKS[SETTING_KEYS.flowIntentHigh]),
    medium: Number(SETTING_FALLBACKS[SETTING_KEYS.flowIntentMedium]),
  };

  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", [SETTING_KEYS.flowIntentHigh, SETTING_KEYS.flowIntentMedium])
      // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
      .returns<{ key: string; value: string }[]>();

    if (error) throw error;

    const gravadas = new Map((data ?? []).map((linha) => [linha.key, linha.value]));

    return sanear(
      {
        high: Number(gravadas.get(SETTING_KEYS.flowIntentHigh) ?? padrao.high),
        medium: Number(gravadas.get(SETTING_KEYS.flowIntentMedium) ?? padrao.medium),
      },
      padrao,
    );
  } catch (erro) {
    console.error(
      `[flow.intent] limites de confiança indisponíveis; usando os padrões: ${
        erro instanceof Error ? erro.message : String(erro)
      }`,
    );
    return padrao;
  }
}

/**
 * ⚠️ CONFIGURAÇÃO INVÁLIDA CAI NO PADRÃO, E NÃO NO VALOR ESCRITO.
 *
 * Este é o campo mais fácil de digitar errado de todo o sistema: alguém escreve
 * "90" querendo dizer noventa por cento, e todo `confidence >= 90` passa a ser
 * falso — o robô para de agir sozinho e ninguém entende por quê, porque nada
 * falhou. Escrever "0,90" com vírgula dá `NaN`, com o mesmo sintoma silencioso.
 *
 * Três recusas, todas para o mesmo lado:
 *   • fora de [0, 1] — quem escreveu pensava em porcentagem;
 *   • `NaN` — vírgula decimal, ou texto;
 *   • `medium > high` — as faixas invertidas, que fariam a de confirmação
 *     desaparecer sem aviso.
 */
function sanear(lidos: ConfidenceThresholds, padrao: ConfidenceThresholds): ConfidenceThresholds {
  const valido = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;

  const high = valido(lidos.high) ? lidos.high : padrao.high;
  const medium = valido(lidos.medium) ? lidos.medium : padrao.medium;

  if (medium > high) return padrao;
  return { high, medium };
}

/* -------------------------------------------------------------------------- */
/* §12, §13, §41 — a leitura                                                  */
/* -------------------------------------------------------------------------- */

export interface ResolveFlowIntentInput {
  /** ⚠️ TEXTO NÃO CONFIÁVEL: é o que a pessoa de fora escreveu. */
  message: string;
  /** Para o log (§44). Nunca sai daqui junto do texto. */
  runId: string;
  nodeId: string;
  correlationId?: string;
}

/**
 * Lê a mensagem e devolve a interpretação — NUNCA um nó.
 *
 * ⚠️ ELA NUNCA LANÇA. Uma exceção aqui subiria pelo webhook e viraria 500, e o
 * fornecedor de WhatsApp reentregaria o payload num laço sobre um erro que não
 * se resolve sozinho. Todo problema vira `FLOW_INTENT_UNAVAILABLE`, que é um
 * valor que o DESENHO consegue tratar (uma seta para o menu numerado, tipicamente).
 *
 * ⚠️ E ELA NÃO CHAMA O MODELO SEM FORNECEDOR CONFIGURADO. `configured` existe
 * para "sem chave de API" ser um estado visível, e não uma exceção no meio de
 * um atendimento.
 */
export async function resolveFlowIntent(input: ResolveFlowIntentInput): Promise<FlowIntentReading> {
  const provider = aiProvider();

  if (!provider.configured) {
    logFlowEngineEvent("info", "flow.intent_skipped", {
      correlationId: input.correlationId,
      runId: input.runId,
      nodeId: input.nodeId,
      reason: "fornecedor de IA nao configurado",
    });
    return unavailableFlowIntent();
  }

  const limites = await loadFlowConfidenceThresholds();

  try {
    const resultado = await provider.classifyIntent({ message: input.message });

    if (!resultado.ok) {
      logFlowEngineEvent("error", "flow.intent_failed", {
        correlationId: input.correlationId,
        runId: input.runId,
        nodeId: input.nodeId,
        reason: resultado.reason,
      });
      return unavailableFlowIntent();
    }

    const leitura = readFlowIntent(resultado.analysis, limites);

    /**
     * §44. O LOG DA IA — e note o que NÃO está aqui.
     *
     * A mensagem da pessoa não entra. O §44 lista "mensagem" entre os campos, e
     * o §44 também manda respeitar a LGPD e "evitar armazenar dados
     * desnecessários" — as duas coisas na mesma seção. A mensagem crua JÁ ESTÁ
     * gravada em `whatsapp_messages`, que é o livro-razão da conversa e tem RLS;
     * repeti-la no log de aplicação a colocaria num lugar sem RLS, sem prazo de
     * descarte e frequentemente exportado para fora — e o `correlationId` já
     * costura este registro àquele, que é o que uma investigação precisa.
     *
     * O que sai é vocabulário fechado: qual intenção, quanta confiança, qual
     * modelo. Nada disso identifica ninguém.
     */
    logFlowEngineEvent("info", "flow.intent_resolved", {
      correlationId: input.correlationId,
      runId: input.runId,
      nodeId: input.nodeId,
      intent: leitura.intent,
      confidence: leitura.confidence,
      band: leitura.band,
      provider: provider.name,
      model: resultado.usage.model,
      promptVersion: resultado.usage.promptVersion,
      latencyMs: resultado.usage.latencyMs,
    });

    return leitura;
  } catch (erro) {
    logFlowEngineEvent("error", "flow.intent_failed", {
      correlationId: input.correlationId,
      runId: input.runId,
      nodeId: input.nodeId,
      reason: erro instanceof Error ? erro.message : String(erro),
    });
    return unavailableFlowIntent();
  }
}

/* -------------------------------------------------------------------------- */
/* §34 — o expediente                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A variável de horário, para o desenho decidir o que fazer com ela.
 *
 * ⚠️ ELA É CALCULADA A CADA TURNO, e não no início do atendimento. Uma conversa
 * que começa às 17h58 e chega ao nó de transferência às 18h02 tem de transferir
 * como fora do expediente — congelar o valor na abertura mandaria a pessoa
 * esperar por um time que já foi embora, dizendo que ele estava lá.
 */
export async function businessHoursVariables(agora: Date = new Date()): Promise<FlowVariables> {
  let spec = SETTING_FALLBACKS[SETTING_KEYS.flowBusinessHours];

  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", SETTING_KEYS.flowBusinessHours)
      // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
      .returns<{ value: string }[]>()
      .maybeSingle();

    if (error) throw error;
    spec = data?.value ?? spec;
  } catch (erro) {
    console.error(
      `[flow.intent] horário de atendimento indisponível; atendendo sempre: ${
        erro instanceof Error ? erro.message : String(erro)
      }`,
    );
  }

  return { [BUSINESS_HOURS_VARIABLE]: isWithinBusinessHours(spec, agora) ? "sim" : "nao" };
}
