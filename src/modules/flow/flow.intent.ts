import { confidenceBand } from "@/modules/intelligence/intent.types";
import type {
  ConfidenceBand,
  ConfidenceThresholds,
  IntentAnalysis,
} from "@/modules/intelligence/intent.types";
import type { FlowVariables } from "./flow.types";

/**
 * A IA VIRA VARIÁVEL, E NUNCA CAMINHO — o §13 do Prompt 4, escrito como código.
 *
 * ⚠️ ESTE ARQUIVO É A GARANTIA, e não o comentário que promete a garantia.
 *
 * O §13 diz que a IA não pode decidir `next_node = X`. A forma de isso ser uma
 * propriedade do sistema, e não uma intenção de quem programou, é o resultado
 * do modelo não ter NENHUM tipo capaz de nomear um nó. O que sai daqui é um
 * `Record<string, string>` — variáveis de contexto, iguaizinhas a "cidade" ou
 * "assunto" que a pessoa digitou. Quem lê essas variáveis e escolhe a seta é
 * `resolveTransition`, que já existia antes da IA entrar e não sabe que ela
 * existe.
 *
 * Ou seja: a IA responde "o que a pessoa quis dizer". O DESENHO responde "e daí
 * o que a gente faz". Trocar o modelo, desligar a IA ou errar a classificação
 * muda a resposta da primeira pergunta e não toca na segunda.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ POR QUE `sys_`, E POR QUE ELE É INDIGITÁVEL
 * ----------------------------------------------------------------------------
 * `variableNameSchema` (flow.schema.ts) exige minúsculas começando por letra,
 * e nada impede alguém de nomear uma variável `sys_intent` no Builder. O
 * prefixo não é imposto pelo schema: é imposto AQUI, escrevendo por cima no
 * fim. Uma variável do desenho com esse nome perde para a do motor, sempre —
 * o que é o certo, porque uma condição que testa `sys_intent` precisa poder
 * confiar em quem escreveu ali.
 *
 * A convenção já vinha de `sys_timeout_reminders` (lib/flow/timeout.ts).
 */

/** O prefixo do que é do MOTOR, e não do desenho. */
export const FLOW_SYSTEM_VARIABLE_PREFIX = "sys_";

/**
 * As quatro variáveis que uma leitura de intenção produz.
 *
 * ⚠️ SÃO QUATRO, E NÃO UMA. A tentação é gravar só `sys_intent` — mas as
 * transições precisam poder perguntar coisas diferentes:
 *
 *   `sys_intent`             "o que ela quer"          → a seta principal
 *   `sys_intent_band`        "dá para confiar nisso?"  → a seta de confirmação
 *   `sys_intent_confidence`  o número cru              → trilha e métrica (§47)
 *   `sys_intent_subject`     "sobre o quê"             → argumento da Action
 *
 * Sem `band`, o §14 e o §15 não têm como existir no desenho: o fluxo não
 * conseguiria distinguir "manda a Bolsa" de "pergunta se é a Bolsa mesmo".
 *
 * Sem `subject`, a Action de normativa não tem o que procurar — é ele que vira
 * o argumento `assunto` em `flow.node-config.ts::actionArguments`.
 */
export const FLOW_INTENT_VARIABLES = {
  intent: "sys_intent",
  confidence: "sys_intent_confidence",
  band: "sys_intent_band",
  subject: "sys_intent_subject",
} as const;

/**
 * O valor de `sys_intent` quando a IA não estava disponível.
 *
 * ⚠️ ELE É DIFERENTE DE `desconhecido`, e a distinção paga por si.
 * `desconhecido` é o modelo tendo lido a frase e não reconhecido o pedido —
 * a resposta certa é "não entendi, reformule". `sys_ia_indisponivel` é o modelo
 * não ter respondido: a pessoa pode ter escrito com clareza total, e repetir
 * "não entendi" a culparia por uma falha nossa.
 *
 * Com os dois separados, o desenhador consegue mandar um para o menu numerado
 * (que funciona sem IA) e o outro para "tente escrever de outro jeito".
 */
export const FLOW_INTENT_UNAVAILABLE = "sys_ia_indisponivel";

/** O que a camada de IA devolveu ao motor, já no vocabulário do fluxo. */
export interface FlowIntentReading {
  /** O nome da intenção, ou `FLOW_INTENT_UNAVAILABLE`. */
  intent: string;
  /** 0 a 1. Zero quando não houve leitura. */
  confidence: number;
  band: ConfidenceBand;
  /** O termo que a pessoa usou, como ela escreveu. */
  subject: string | null;
}

/**
 * Lê a análise do modelo com os limites que a APCS configurou.
 *
 * ⚠️ `sensitive: false` SEMPRE, e é deliberado. A barra extra de
 * `CONFIDENCE_HIGH_SENSITIVE` protege o robô de UM TURNO, que executa a ação no
 * mesmo instante em que classifica. Aqui a classificação não executa nada: ela
 * grava uma variável, e o que decide se aquilo vira uma solicitação de palestra
 * é uma seta que uma pessoa desenhou olhando para a tela. A proteção contra
 * ação sensível, neste caminho, é o DESENHO — normalmente uma pergunta de
 * confirmação antes do nó de ação, que é o §15.
 *
 * Aplicar a barra sensível aqui puniria o fluxo bem desenhado: ele já pergunta,
 * e ainda assim exigiria 0,85 para chegar até a pergunta.
 */
export function readFlowIntent(
  analysis: IntentAnalysis,
  thresholds: ConfidenceThresholds,
): FlowIntentReading {
  return {
    intent: analysis.intent,
    confidence: analysis.confidence,
    band: confidenceBand(analysis.confidence, false, thresholds),
    subject: analysis.subject,
  };
}

/** A leitura de quando o modelo não respondeu (§46 do módulo de inteligência). */
export function unavailableFlowIntent(): FlowIntentReading {
  return {
    intent: FLOW_INTENT_UNAVAILABLE,
    confidence: 0,
    // ⚠️ `low` E NÃO UMA QUARTA FAIXA. Quem lê `sys_intent_band` está perguntando
    // "dá para agir por conta disto?", e a resposta é não — a mesma de uma
    // leitura ruim. A diferença entre "não entendi" e "não consegui ler" está em
    // `sys_intent`, que é onde ela é acionável.
    band: "low",
    subject: null,
  };
}

/**
 * As variáveis a fundir no contexto.
 *
 * ⚠️ A CONFIANÇA VAI COMO TEXTO COM DUAS CASAS, e o formato importa: as
 * variáveis de fluxo são `Record<string, string>` (é o que atravessa o jsonb do
 * `flow_runs.variables`), e os operadores numéricos do §14 do Prompt 3 —
 * `gt`, `gte`, `lt`, `lte` — fazem `Number(...)` do texto. "0.95" compara certo;
 * "0,95" não, e é por isso que aqui é ponto e nunca vírgula, mesmo o resto da
 * interface sendo PT-BR.
 *
 * ⚠️ E O ASSUNTO AUSENTE VIRA STRING VAZIA, e não fica de fora. Uma variável
 * ausente não casa com operador nenhum (nem com `neq`) — ver `flow.operators.ts`.
 * Gravando vazio, o desenhador consegue perguntar `sys_intent_subject exists`
 * e receber "não", que é a pergunta que ele de fato quer fazer.
 */
export function flowIntentVariables(reading: FlowIntentReading): FlowVariables {
  return {
    [FLOW_INTENT_VARIABLES.intent]: reading.intent,
    [FLOW_INTENT_VARIABLES.confidence]: reading.confidence.toFixed(2),
    [FLOW_INTENT_VARIABLES.band]: reading.band,
    [FLOW_INTENT_VARIABLES.subject]: reading.subject ?? "",
  };
}

/**
 * Funde a leitura no contexto, com o motor tendo a última palavra.
 *
 * Ver o aviso sobre `sys_` no topo: a ordem do spread É a regra.
 */
export function withFlowIntent(
  variables: FlowVariables,
  reading: FlowIntentReading,
): FlowVariables {
  return { ...variables, ...flowIntentVariables(reading) };
}

/**
 * APAGA A LEITURA. Chamado no início de TODO turno, antes de qualquer coisa.
 *
 * ============================================================================
 * ⚠️ A LEITURA VALE POR UM TURNO, E ESTA FUNÇÃO É O QUE GARANTE ISSO.
 * ============================================================================
 *
 * É a mesma doutrina que o motor já aplicava à chave da resposta ("⚠️ A CHAVE
 * DA RESPOSTA NÃO ATRAVESSA", em `percorrerDaPergunta`), e ela chegou aqui pelo
 * mesmo caminho: um teste que falhou mostrando o estrago.
 *
 * O CASO CONCRETO, porque ele não é óbvio e custa caro:
 *
 *   turno 1  a pessoa escreve "quero saber o valor do suíno".
 *            A IA lê `consultar_bolsa`, confiança 0,99 → `sys_intent_band=high`.
 *            O fluxo confirma, ela diz que não, e volta ao menu.
 *
 *   turno 2  ela digita "3" — "Falar com um atendente".
 *            `matchOption` casa com ATENDENTE, e o motor procura a saída. Não
 *            há seta `answer` para ATENDENTE naquele desenho, então ele desce
 *            para as setas de VARIÁVEL — e `sys_intent_band` AINDA VALE `high`,
 *            de um turno que acabou.
 *
 *            A pessoa pediu um atendente e recebeu a Bolsa. Nada falhou, nada
 *            apareceu no log como erro, e o desenho na tela não explica.
 *
 * Apagando no começo do turno, uma variável `sys_intent*` só existe quando o
 * modelo acabou de ler ESTA mensagem. As setas de intenção param de casar
 * sozinhas, e a escolha explícita da pessoa volta a ser a última palavra.
 *
 * ⚠️ E O QUE ESTAVA NO TURNO CONTINUA GRAVADO onde importa: a travessia inteira
 * daquele turno — incluindo uma transferência para atendente decidida pela
 * intenção — foi comitada com as variáveis presentes, e o passo em
 * `flow_run_steps` guarda o que aconteceu. O que se apaga é a validade FUTURA
 * da leitura, e não o registro dela.
 */
export function withoutFlowIntent(variables: FlowVariables): FlowVariables {
  const limpas = { ...variables };
  for (const nome of Object.values(FLOW_INTENT_VARIABLES)) {
    delete limpas[nome];
  }
  return limpas;
}
