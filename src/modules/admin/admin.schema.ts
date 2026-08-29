import { z } from "zod";
import { VALID_ROLES } from "@/lib/rbac/rbac.types";
import { SETTING_KEYS } from "./admin.labels";

/**
 * Contratos de entrada da Administração. Os mesmos schemas rodam no cliente e
 * dentro das actions — e o banco repete cada regra numa função `SECURITY
 * DEFINER`, que é quem realmente decide.
 */

export const setUserRoleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(VALID_ROLES, {
    errorMap: () => ({ message: "Selecione um papel válido." }),
  }),
});

export type SetUserRoleInput = z.input<typeof setUserRoleSchema>;

/**
 * O convite.
 *
 * ⚠️ O PAPEL VAI JUNTO DO CONVITE, e não numa segunda etapa. Sem isso, toda
 * pessoa convidada entraria como `viewer` (é o que o trigger `handle_new_user`
 * faz) e alguém teria de lembrar de voltar na lista para promovê-la — o que
 * significa gente esperando acesso porque um segundo clique foi esquecido.
 */
export const inviteUserSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, { message: "Informe o e-mail de quem vai receber o convite." })
    .max(255, { message: "E-mail muito longo." })
    .email({ message: "E-mail inválido. Confira se há @ e domínio." })
    .transform((v) => v.toLowerCase()),
  fullName: z
    .string()
    .trim()
    .max(120, { message: "Use no máximo 120 caracteres." })
    .optional()
    .transform((v) => (v ? v : undefined)),
  role: z.enum(VALID_ROLES, {
    errorMap: () => ({ message: "Selecione o papel de quem está sendo convidado." }),
  }),
});

export type InviteUserInput = z.input<typeof inviteUserSchema>;

export const updateSegmentSchema = z.object({
  segmentId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(2, { message: "Informe o nome do público." })
    .max(120, { message: "Use no máximo 120 caracteres." }),
  description: z
    .string()
    .trim()
    .max(300, { message: "Use no máximo 300 caracteres." })
    .optional()
    .transform((v) => (v ? v : undefined)),
  active: z.boolean(),
});

export type UpdateSegmentInput = z.input<typeof updateSegmentSchema>;

const SETTING_KEY_VALUES = Object.values(SETTING_KEYS) as [string, ...string[]];

export const setSettingSchema = z.object({
  // ⚠️ Enum das chaves conhecidas, e não `z.string()`. Ver o comentário de
  // `SETTING_KEYS`: uma chave digitada errado grava uma linha que ninguém lê.
  key: z.enum(SETTING_KEY_VALUES, {
    errorMap: () => ({ message: "Configuração desconhecida." }),
  }),
  value: z
    .string()
    .trim()
    .min(1, { message: "O texto não pode ficar vazio." })
    .max(2000, { message: "Use no máximo 2000 caracteres." }),
});

export type SetSettingInput = z.input<typeof setSettingSchema>;

/**
 * Publicar uma versão nova do texto de consentimento.
 *
 * ⚠️ A VERSÃO É DIGITADA, e não gerada. Poderia ser automática (`2026-08-v2`),
 * e seria pior: quem publica precisa poder dizer se aquilo é uma correção de
 * vírgula ou uma mudança de finalidade do tratamento — e essa diferença é
 * jurídica, não técnica. O banco recusa reescrever uma versão que já existe
 * (AD003), então o pior caso é ter de escolher outro nome.
 */
export const publishConsentSchema = z.object({
  version: z
    .string()
    .trim()
    .min(3, { message: "Informe a versão (ex.: 2026-09-v1)." })
    .max(40, { message: "Use no máximo 40 caracteres." })
    .regex(/^[0-9a-zA-Z._-]+$/, {
      message: "Use apenas letras, números, ponto, hífen ou sublinhado.",
    }),
  body: z
    .string()
    .trim()
    .min(20, { message: "O texto de consentimento precisa dizer o que será feito com os dados." })
    .max(2000, { message: "Use no máximo 2000 caracteres." }),
});

export type PublishConsentInput = z.input<typeof publishConsentSchema>;

/** Desfazer um bloqueio pela lista. A nota é a autorização — ver MA008. */
export const resumeBlockSchema = z.object({
  blockId: z.string().uuid(),
  note: z
    .string()
    .trim()
    .min(5, { message: "Diga quem pediu para voltar a receber e por onde." })
    .max(300, { message: "Use no máximo 300 caracteres." }),
});

export type ResumeBlockInput = z.input<typeof resumeBlockSchema>;
