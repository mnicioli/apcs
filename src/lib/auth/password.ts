import { z } from "zod";

/**
 * A regra da senha nova.
 *
 * ⚠️ OITO CARACTERES, E NÃO SEIS. Seis é o mínimo que o Supabase aceita por
 * padrão; deixá-lo valer aqui seria terceirizar a regra para uma configuração
 * de painel que ninguém deste lado revisa. O piso está no código, versionado e
 * testado — se um dia subir para dez, sobe aqui e o teste acusa.
 *
 * ⚠️ NÃO EXIGE MAIÚSCULA, NÚMERO E SÍMBOLO. Regra de composição empurra as
 * pessoas para "Senha@2026" — previsível para quem ataca, esquecível para quem
 * usa. Comprimento é o fator que realmente pesa; o teto de 72 é do bcrypt, que
 * ignora silenciosamente o que passar disso (uma senha de 100 caracteres
 * autenticaria com os 72 primeiros, e quem escolheu a frase longa não saberia).
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/**
 * O par senha + confirmação.
 *
 * A confirmação existe porque este formulário não tem como avisar depois: quem
 * digita errado só descobre no próximo login, sem nenhuma senha para tentar.
 */
export const newPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmation: z.string(),
  })
  .refine((valores) => valores.password === valores.confirmation, {
    path: ["confirmation"],
    message: "As senhas não conferem.",
  });

export type NewPasswordInput = z.infer<typeof newPasswordSchema>;

/** O e-mail do formulário de recuperação. Minúsculas, como no resto do sistema. */
export const resetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});
