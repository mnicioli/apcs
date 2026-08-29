import { z } from "zod";

/**
 * O contrato de entrada da divulgação.
 *
 * ⚠️ NÃO EXISTE CAMPO DE TEXTO AQUI, e a ausência é a decisão de segurança
 * central deste módulo. A tela manda "qual módulo, qual registro, quais
 * públicos" — o CORPO da mensagem é composto no servidor, lendo o registro. Um
 * campo `body` transformaria esta action num disparador de texto livre para
 * toda a base de associados, assinado pelo número da APCS, com um clique.
 *
 * O preço é real e aceito: quem divulga não pode escrever um recado
 * personalizado. Se um dia isso for necessário, é um recurso próprio — com
 * aprovação, pré-visualização e trilha —, não um campo a mais neste schema.
 */

export const BROADCAST_SOURCES = [
  "normative",
  "communication",
  "market_bulletin",
  "lecture",
] as const;

export const startBroadcastSchema = z.object({
  source: z.enum(BROADCAST_SOURCES, {
    errorMap: () => ({ message: "Origem de divulgação desconhecida." }),
  }),
  sourceId: z.string().uuid(),
  segmentIds: z
    .array(z.string().uuid())
    .min(1, { message: "Escolha ao menos um público-alvo." })
    // Teto pelo número de públicos que existem — uma lista gigante vinda da
    // tela é entrada malformada, não uma escolha.
    .max(20, { message: "Públicos-alvo demais." }),
});

export type StartBroadcastInput = z.input<typeof startBroadcastSchema>;

/** Continuar uma divulgação que parou no meio do orçamento de tempo. */
export const resumeBroadcastSchema = z.object({
  broadcastId: z.string().uuid(),
});

export type ResumeBroadcastInput = z.input<typeof resumeBroadcastSchema>;

/** Consultar o alcance antes de clicar. */
export const audienceSizeSchema = z.object({
  segmentIds: z.array(z.string().uuid()).max(20),
});

export type AudienceSizeInput = z.input<typeof audienceSizeSchema>;
