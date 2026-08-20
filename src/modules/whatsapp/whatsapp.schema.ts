import { z } from "zod";

/**
 * A validação da caixa de entrada. O MESMO schema roda no formulário e na
 * action — é o padrão do projeto, e o motivo é que a validação do cliente é
 * conveniência e a do servidor é a que vale.
 */

/**
 * ⚠️ O TETO DE 4096 NÃO É ARBITRÁRIO: é o limite de uma mensagem de texto do
 * WhatsApp. Deixar passar mais faria o fornecedor recusar DEPOIS do clique, com
 * uma mensagem em inglês, depois de o atendente ter escrito o parágrafo inteiro.
 */
export const WHATSAPP_MAX_BODY = 4096;

export const uuidSchema = z.string().uuid("Conversa inválida.");

export const sendWhatsAppMessageSchema = z.object({
  chatId: uuidSchema,
  body: z
    .string()
    .trim()
    .min(1, "Escreva a mensagem antes de enviar.")
    .max(WHATSAPP_MAX_BODY, `A mensagem não pode passar de ${WHATSAPP_MAX_BODY} caracteres.`),
});

export type SendWhatsAppMessageInput = z.infer<typeof sendWhatsAppMessageSchema>;

export const archiveWhatsAppChatSchema = z.object({
  chatId: uuidSchema,
  archived: z.boolean(),
});

export type ArchiveWhatsAppChatInput = z.infer<typeof archiveWhatsAppChatSchema>;

/**
 * Como uma conversa aparece na lista quando não há nome nenhum.
 *
 * Fica no schema — e não na tela — porque a lista, o cabeçalho da conversa e o
 * título da aba do navegador precisam da MESMA resposta. Três lugares
 * inventando o próprio "sem nome" produzem três nomes para a mesma pessoa.
 */
export function whatsappDisplayName(chat: {
  name: string | null;
  phone: string | null;
  isGroup: boolean;
}): string {
  const nome = chat.name?.trim();
  if (nome) return nome;
  if (chat.phone) return formatWhatsAppPhone(chat.phone);
  return chat.isGroup ? "Grupo sem nome" : "Contato sem nome";
}

/**
 * `5554991234567` → `(54) 99123-4567`.
 *
 * O fornecedor entrega E.164; ninguém na APCS lê um telefone assim. O que não
 * casar com o formato brasileiro sai como veio — inventar uma máscara para um
 * número estrangeiro produziria algo que não é telefone em lugar nenhum.
 */
export function formatWhatsAppPhone(e164: string): string {
  const digitos = e164.replace(/\D/g, "");
  const nacional = digitos.length >= 12 && digitos.startsWith("55") ? digitos.slice(2) : digitos;

  if (nacional.length === 11) {
    return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 7)}-${nacional.slice(7)}`;
  }
  if (nacional.length === 10) {
    return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 6)}-${nacional.slice(6)}`;
  }
  return e164;
}
