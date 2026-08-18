/**
 * Telefone brasileiro → E.164, e o veredito sobre se dá para mandar WhatsApp.
 *
 * Sem `server-only`: é função pura, não lê ambiente e não toca em segredo. O
 * teste precisa importá-la, e a barreira de servidor está em quem a chama.
 *
 * ⚠️ ESTA É A ÚNICA IMPLEMENTAÇÃO DA REGRA (§30). O banco não a repete de
 * propósito: duas cópias de "o que é um número válido" divergem no primeiro
 * ajuste, e a divergência aparece como "o sistema disse que ia enviar e não
 * enviou". A elegibilidade em SQL cuida do que é do SQL (opt-out); o formato é
 * daqui.
 */

/**
 * Os DDDs que existem. Sim, é uma lista — e é de propósito.
 *
 * `\d{2}` aceitaria 00, 10, 23, 25... que não são DDD nenhum. Um número com DDD
 * inexistente é rejeitado pelo fornecedor DEPOIS de gastar uma chamada, uma
 * tentativa e uma linha de erro; conferir aqui custa um `has`.
 */
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77,
  79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export type PhoneRejection =
  | "empty"
  | "too_short"
  | "too_long"
  | "unknown_area"
  | "landline"
  | "malformed";

export type PhoneResult =
  | { ok: true; e164: string; ddd: number }
  | { ok: false; reason: PhoneRejection };

/**
 * As frases que vão para `last_error` do destinatário. Alguém vai ler isto na
 * tela de participantes tentando entender por que a mensagem não saiu — então
 * dizem o que fazer, não o que falhou.
 */
export const PHONE_REJECTION_REASONS: Record<PhoneRejection, string> = {
  empty: "Contato sem telefone cadastrado.",
  too_short: "Telefone incompleto: faltam dígitos.",
  too_long: "Telefone com dígitos demais.",
  unknown_area: "DDD inexistente no telefone cadastrado.",
  landline: "Telefone fixo não recebe WhatsApp. Cadastre um celular.",
  malformed: "Telefone em formato não reconhecido.",
};

/**
 * Aceita o que os cadastros do projeto realmente contêm:
 * `(19) 99123-4567`, `19991234567`, `+55 19 99123-4567`, `5519991234567`.
 *
 * ⚠️ SÓ CELULAR PASSA. Um fixo é um telefone perfeitamente válido que
 * simplesmente não tem WhatsApp — e mandar para ele não dá erro na hora, dá
 * "não entregue" horas depois, quando ninguém mais está olhando. Recusar antes
 * transforma um mistério em uma linha de tarefa: "cadastre um celular".
 *
 * Este projeto tem um caso real: um dos contatos da base é `(14) 3622-8140`.
 */
export function toWhatsAppNumber(raw: string | null | undefined): PhoneResult {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 0) return { ok: false, reason: "empty" };

  // Tira o código do país quando ele veio junto. `55` também é o DDD do Rio
  // Grande do Sul, então a decisão não pode ser "começa com 55": ela é pelo
  // COMPRIMENTO. 5511987654321 tem 13 dígitos (país + DDD + 9 dígitos);
  // 5511876543 tem 10 e é um fixo de Caxias do Sul.
  const nacional = digits.length >= 12 && digits.startsWith("55") ? digits.slice(2) : digits;

  if (nacional.length < 10) return { ok: false, reason: "too_short" };
  if (nacional.length > 11) return { ok: false, reason: "too_long" };

  const ddd = Number(nacional.slice(0, 2));
  if (!DDDS.has(ddd)) return { ok: false, reason: "unknown_area" };

  const assinante = nacional.slice(2);

  // Celular brasileiro: 9 dígitos começando em 9. Fixo: 8 dígitos começando
  // entre 2 e 5. Qualquer outra coisa não é nenhum dos dois.
  if (assinante.length === 9 && assinante.startsWith("9")) {
    return { ok: true, e164: `55${nacional}`, ddd };
  }
  if (assinante.length === 8 && /^[2-5]/.test(assinante)) {
    return { ok: false, reason: "landline" };
  }
  return { ok: false, reason: "malformed" };
}

/**
 * O caminho de volta: o fornecedor devolve `5519991234567` e precisamos achar o
 * contato, cujo telefone está gravado como `(19) 99123-4567`.
 *
 * ⚠️ NÃO COMPARA TEXTO. Comparar as strings cruas erraria em todo contato
 * formatado — que neste banco são todos. A comparação é entre as formas E.164.
 */
export function sameWhatsAppNumber(a: string | null | undefined, b: string | null | undefined) {
  const x = toWhatsAppNumber(a);
  const y = toWhatsAppNumber(b);
  return x.ok && y.ok && x.e164 === y.e164;
}

/**
 * Máscara para log e mensagem de erro (§50, §54).
 *
 * Telefone é dado pessoal. O log precisa de identificação suficiente para
 * alguém casar uma linha com um relato ("o número terminado em 4477"), e não
 * precisa do número inteiro.
 */
export function maskPhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}
