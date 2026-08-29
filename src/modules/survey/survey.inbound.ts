import type { SurveyOption } from "./survey.types";

/**
 * COMO SE LÊ O QUE A PESSOA ESCREVEU (§10, §11, §12, §13, §32, §39).
 *
 * Função pura, sem banco e sem rede: dá para provar cada frase num teste.
 *
 * ⚠️ A DISTINÇÃO QUE SUSTENTA TUDO AQUI é entre "errou a resposta" e "não
 * estava respondendo".
 *
 *   "6" numa enquete de 5 opções  → ERROU. Merece o texto do §11.
 *   "bom dia, preciso de ajuda"   → NÃO ESTAVA RESPONDENDO. O §39 diz para não
 *                                   bloquear: isso volta ao atendimento normal,
 *                                   e a enquete continua esperando.
 *
 * Colapsar os dois em "inválido" produziria o pior atendimento possível: uma
 * pessoa que manda "bom dia" recebe "escolha uma das opções apresentadas", e
 * três bons-dias depois é expulsa da enquete por excesso de erro.
 */

export type SurveyReplyReading =
  | { kind: "option"; position: number; matchedBy: "number" | "text" }
  | { kind: "invalid" }
  | { kind: "ambiguous_text"; positions: number[] }
  | { kind: "opt_out" }
  | { kind: "wants_human" }
  | { kind: "unrelated" };

/**
 * §32. As palavras de saída.
 *
 * Ficam aqui, e não num regex solto, porque toda mensageria séria precisa
 * responder "como alguém para de receber?" — e a resposta tem de ser uma lista
 * que dá para ler.
 */
const PALAVRAS_SAIR = new Set([
  "sair",
  "parar",
  "pare",
  "stop",
  "cancelar",
  "descadastrar",
  "descadastre",
  "remover",
  "sair da lista",
  "nao quero receber",
  "nao quero mais receber",
  "nao me mande mais",
]);

/** §39. Quem pede gente, recebe gente — a enquete solta a conversa. */
const PALAVRAS_HUMANO = new Set([
  "atendente",
  "humano",
  "falar com alguem",
  "quero falar com alguem",
  "atendimento",
  "suporte",
  "pessoa",
]);

/**
 * Prefixos que acompanham um número sem mudar o que ele significa (§10).
 * "opção 1", "opcao 1", "alternativa 2", "n 3", "numero 3", "item 4".
 */
const PREFIXO_NUMERO =
  /^(?:a\s+)?(?:op(?:c|ç)(?:a|ã)o|alternativa|resposta|item|numero|n[.º°]?)\s*[:.-]?\s*/;

/**
 * Normaliza para comparação: minúsculas, sem acento, sem pontuação de borda,
 * sem espaço duplicado.
 *
 * ⚠️ Os dois caracteres invisíveis do `replace` são o detalhe que quebraria
 * tudo em silêncio: o WhatsApp entrega o teclado numérico como "1" seguido de
 * U+FE0F (seletor de variação) e U+20E3 (combinador de teclado). Para
 * um regex de dígito isso NÃO é um dígito — e a pessoa que clicou no número
 * que o bot mandou receberia "opção inválida".
 */
export function normalizeReply(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\ufe0f\u20e3]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "Esta mensagem é um pedido para parar de receber?"
 *
 * ⚠️ EXPORTADA PARA SER USADA FORA DE ENQUETES, e é por isso que ela existe
 * separada: quem recebe a divulgação de um EVENTO e responde SAIR não tem
 * conversa de enquete nenhuma, então `readSurveyReply` nunca chegava a rodar
 * para essa pessoa. Foi exatamente esse o bug.
 *
 * ⚠️ REUSA `PALAVRAS_SAIR`, e isso não é economia de linhas: duas listas de
 * palavras de saída, uma para enquete e outra para evento, divergiriam na
 * primeira vez que alguém acrescentasse um sinônimo em uma só — e o sintoma
 * seria uma pessoa que consegue sair de um canal e não do outro.
 */
export function isOptOutRequest(raw: string): boolean {
  return PALAVRAS_SAIR.has(normalizeReply(raw));
}

export function readSurveyReply(raw: string, options: readonly SurveyOption[]): SurveyReplyReading {
  const texto = normalizeReply(raw);
  if (texto.length === 0) return { kind: "unrelated" };

  if (PALAVRAS_SAIR.has(texto)) return { kind: "opt_out" };
  if (PALAVRAS_HUMANO.has(texto)) return { kind: "wants_human" };

  const ativas = options.filter((o) => o.active);

  // 1. §10. O número, com ou sem prefixo.
  const semPrefixo = texto.replace(PREFIXO_NUMERO, "").trim();
  if (/^\d{1,3}$/.test(semPrefixo)) {
    const numero = Number(semPrefixo);
    const escolhida = ativas.find((o) => o.position === numero);
    // ⚠️ Um número fora da faixa é ERRO DE RESPOSTA, não conversa alheia: quem
    // digita "7" está claramente tentando escolher uma alternativa.
    return escolhida
      ? { kind: "option", position: escolhida.position, matchedBy: "number" }
      : { kind: "invalid" };
  }

  // 2. §13. O texto exato da alternativa. Exato primeiro, e é isso que faz
  // "Aumentar" escolher "Aumentar" em vez de empatar com "Aumentar muito".
  const exatas = ativas.filter((o) => normalizeReply(o.text) === texto);
  if (exatas.length === 1) {
    return { kind: "option", position: exatas[0]!.position, matchedBy: "text" };
  }
  if (exatas.length > 1) {
    return { kind: "ambiguous_text", positions: exatas.map((o) => o.position) };
  }

  // 3. §13. Correspondência parcial — só quando é INEQUÍVOCA.
  const parciais = ativas.filter((o) => {
    const alvo = normalizeReply(o.text);
    return alvo.startsWith(texto) || texto.startsWith(alvo);
  });
  if (parciais.length === 1) {
    return { kind: "option", position: parciais[0]!.position, matchedBy: "text" };
  }
  if (parciais.length > 1) {
    // §13: "não aceitar correspondência ambígua." Duas alternativas plausíveis
    // e um palpite errado é um voto errado registrado como certo — e ninguém
    // descobre, porque a urna não guarda o texto que a pessoa mandou.
    return { kind: "ambiguous_text", positions: parciais.map((o) => o.position) };
  }

  // 4. §39/§43/§44. Não é sobre a enquete.
  return { kind: "unrelated" };
}

/**
 * §11/§13. A frase que pede a escolha de novo, listando as alternativas.
 *
 * Repetir a lista é deliberado: a mensagem original pode ter subido dezenas de
 * mensagens no histórico, e "escolha uma das opções apresentadas" sem as opções
 * manda a pessoa procurar.
 */
export function repeatOptionsMessage(
  intro: string,
  options: readonly { position: number; text: string }[],
): string {
  const linhas = options.map((o) => `${o.position} - ${o.text}`).join("\n");
  return `${intro}\n\n${linhas}`;
}
