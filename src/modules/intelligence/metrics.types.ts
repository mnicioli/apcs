import type { InteractionOutcome } from "@/lib/intelligence/log";

/**
 * §35. OS KPIs DO ROBÔ — o tipo das três views.
 *
 * ⚠️ OS NOMES SÃO OS DAS COLUNAS DO BANCO, em português. É a exceção à regra do
 * projeto ("código em inglês"), e ela existe porque estes objetos são o
 * resultado literal de um `select *` sobre uma view: renomear em TypeScript
 * criaria dois vocabulários para a mesma coisa, e a consulta que alguém escrever
 * no SQL Editor para conferir um número não bateria com o que a tela mostra.
 */

export interface IntelligenceDailyMetrics {
  /** AAAA-MM-DD, no fuso da APCS. */
  dia: string;
  turnos: number;
  conversas: number;

  /**
   * §37. Quantas mensagens o robô não classificou.
   *
   * Muito disto é INTENÇÃO FALTANDO — gente pedindo coisas que o registro não
   * cobre. É o número que diz quando vale acrescentar uma intenção.
   */
  desconhecidos: number;
  /**
   * §36. Quantas viraram atendimento humano.
   *
   * Muito disto é CONHECIMENTO FALTANDO — perguntas que a Base de Conhecimento
   * responderia se tivesse a entrada. É um número diferente do de cima, e a
   * ação que ele pede também é.
   */
  encaminhamentos: number;

  entregas: number;
  /** Entendeu, e a APCS não tinha o que mandar. Trabalho de quem publica. */
  sem_conteudo: number;
  /** Quebrou. Trabalho de quem cuida do sistema. */
  erros: number;
  confirmacoes: number;

  latencia_media_ms: number | null;
  confianca_media: number | null;

  /**
   * ⚠️ SÓ OS TURNOS QUE PASSARAM PELO MODELO. Um "sim" ou uma escolha de menu
   * custou zero — dividir os tokens por `turnos` faria o custo por classificação
   * parecer menor do que é.
   */
  turnos_com_modelo: number;
  tokens_entrada: number | null;
  tokens_saida: number | null;
}

export interface IntelligenceIntentTotal {
  intent: string;
  turnos: number;
  confianca_media: number | null;
  entregas: number;
  sem_conteudo: number;
  erros: number;
}

/** §37. Uma pergunta que o robô não respondeu, com o texto original. */
export interface UnknownQuestion {
  id: number;
  created_at: string;
  whatsapp_chat_id: string | null;
  confidence: number | null;
  outcome: InteractionOutcome;
  /** O que a pessoa escreveu. Vem de `whatsapp_messages`. */
  pergunta: string;
}

/**
 * As taxas do §35, calculadas a partir das linhas diárias.
 *
 * ⚠️ FUNÇÃO PURA, e não colunas na view. Uma taxa é uma DIVISÃO, e dividir no
 * banco significaria escolher ali o que fazer com o denominador zero — um dia
 * sem turno nenhum viraria `null` ou `0`, e os dois mentem de formas
 * diferentes num gráfico. Somando as linhas antes de dividir, o período todo dá
 * uma conta só e a divisão por zero acontece num lugar só.
 */
export interface IntelligenceRates {
  turnos: number;
  conversas: number;
  /** Fração de 0 a 1, ou `null` quando não houve turno para dividir. */
  identificacao: number | null;
  handoff: number | null;
  erro: number | null;
  latenciaMediaMs: number | null;
  tokensPorClassificacao: number | null;
}

export function computeRates(dias: readonly IntelligenceDailyMetrics[]): IntelligenceRates {
  const soma = (pegar: (d: IntelligenceDailyMetrics) => number | null) =>
    dias.reduce((total, dia) => total + (pegar(dia) ?? 0), 0);

  const turnos = soma((d) => d.turnos);
  const comModelo = soma((d) => d.turnos_com_modelo);
  const tokens = soma((d) => d.tokens_entrada) + soma((d) => d.tokens_saida);

  const taxa = (parte: number) => (turnos > 0 ? parte / turnos : null);

  return {
    turnos,
    conversas: soma((d) => d.conversas),
    // ⚠️ IDENTIFICAÇÃO É O COMPLEMENTO DE `desconhecido`, e não a soma de
    // entregas. Um turno que perguntou "qual normativa?" foi identificado com
    // sucesso, mesmo sem ter entregue documento nenhum.
    identificacao: taxa(turnos - soma((d) => d.desconhecidos)),
    handoff: taxa(soma((d) => d.encaminhamentos)),
    erro: taxa(soma((d) => d.erros)),
    latenciaMediaMs:
      turnos > 0
        ? Math.round(dias.reduce((t, d) => t + (d.latencia_media_ms ?? 0) * d.turnos, 0) / turnos)
        : null,
    tokensPorClassificacao: comModelo > 0 ? Math.round(tokens / comModelo) : null,
  };
}
