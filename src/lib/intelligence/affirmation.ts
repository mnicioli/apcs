import { classifyConsentReply } from "@/lib/chat/consent";

/**
 * "SIM" OU "NÃO" — determinístico, sem LLM.
 *
 * ⚠️ POR QUE NÃO PASSAR ISTO PELO CLASSIFICADOR. A resposta a uma confirmação
 * decide se uma AÇÃO acontece — inclusive as sensíveis, como abrir uma
 * solicitação de palestra ou chamar uma pessoa. Um falso positivo aqui não é um
 * mal-entendido: é uma solicitação que alguém vai ter de despachar, criada
 * porque um modelo achou que "pode ser" era um sim.
 *
 * É o mesmo raciocínio do gate de consentimento (`src/lib/chat/consent.ts`), e
 * por isso ele é reaproveitado em vez de reescrito: o vocabulário de "sim" e
 * "não" em português informal é o mesmo nos dois lugares, e duas listas de
 * padrões divergiriam na primeira gíria que alguém acrescentasse a uma só.
 *
 * ⚠️ O ACOPLAMENTO TEM UM PREÇO, e ele é aceitável: um padrão acrescentado lá
 * passa a valer aqui. Como o que se acrescenta àquela lista é sempre uma forma
 * nova de dizer sim ou não, o efeito é o desejado. O que NÃO pode acontecer é
 * o contrário — acrescentar aqui algo específico de confirmação e vazar para o
 * consentimento LGPD. Por isso este arquivo só CHAMA, e não estende.
 *
 * "Não decidiu" é sempre o lado seguro: `unknown` faz o roteador tratar a
 * mensagem como uma frase comum, e o classificador decide o que ela é.
 */

export type Affirmation = "yes" | "no" | "unknown";

export function readAffirmation(message: string): Affirmation {
  const resposta = classifyConsentReply({ message });

  switch (resposta) {
    case "accept":
      return "yes";
    case "decline":
      return "no";
    default:
      return "unknown";
  }
}
