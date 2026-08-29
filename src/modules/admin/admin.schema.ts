import { z } from "zod";
import { roleKeySchema } from "./role.schema";
import { SETTING_KEYS } from "./admin.labels";

/**
 * Contratos de entrada da Administração. Os mesmos schemas rodam no cliente e
 * dentro das actions — e o banco repete cada regra numa função `SECURITY
 * DEFINER`, que é quem realmente decide.
 */

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
  // ⚠️ CARGO, e não papel do enum. Desde 20260903000100 a APCS cria cargos
  // próprios, e convidar alguém só para "Comercial" quando existe um
  // "Secretaria" seria oferecer metade da lista.
  role: roleKeySchema,
});

export type InviteUserInput = z.input<typeof inviteUserSchema>;

/**
 * Editar o cadastro de um usuário.
 *
 * ⚠️ O PAPEL NÃO ESTÁ AQUI, e a ausência é decisão. Trocar papel tem duas
 * travas próprias no banco (não rebaixar o último admin, não trocar o próprio),
 * e uma delas depende de contar linhas. Misturar isso num "salvar" junto com o
 * nome faria uma edição de nome falhar por causa de uma regra sobre papéis —
 * e a pessoa não saberia qual campo recusou. Papel continua em `set_user_role`.
 */
export const updateUserSchema = z.object({
  userId: z.string().uuid(),
  fullName: z
    .string()
    .trim()
    .min(2, { message: "Informe o nome de quem usa a conta." })
    .max(120, { message: "Use no máximo 120 caracteres." }),
  email: z
    .string()
    .trim()
    .min(1, { message: "O e-mail não pode ficar vazio: é ele que faz o login." })
    .max(254, { message: "E-mail muito longo." })
    .email({ message: "E-mail inválido. Confira se há @ e domínio." })
    .transform((v) => v.toLowerCase()),
});

export type UpdateUserInput = z.input<typeof updateUserSchema>;

export const setUserActiveSchema = z.object({
  userId: z.string().uuid(),
  active: z.boolean(),
});

export type SetUserActiveInput = z.input<typeof setUserActiveSchema>;

/** Disparar a recuperação de senha de alguém. Só o id: o e-mail vem do banco. */
export const resetUserPasswordSchema = z.object({
  userId: z.string().uuid(),
});

export type ResetUserPasswordInput = z.input<typeof resetUserPasswordSchema>;

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
