import { z } from "zod";
import { ALL_PERMISSIONS } from "@/lib/rbac/rbac.labels";
import { VALID_ROLES } from "@/lib/rbac/rbac.types";

/**
 * Contratos de entrada dos CARGOS.
 *
 * Os mesmos schemas rodam no cliente e dentro das actions — e o banco repete
 * cada regra nas funções `create_app_role` / `update_app_role`, que é quem
 * realmente decide. Ver 20260903000100_custom_roles.sql.
 */

const PERMISSION_VALUES = ALL_PERMISSIONS as unknown as [string, ...string[]];

/**
 * ⚠️ A CHAVE TEM AS MESMAS REGRAS DO CHECK `app_roles_key_format`, e a
 * duplicação é proposital: aqui ela vira uma frase que diz o que fazer, lá ela
 * vira a garantia. Se as duas divergirem, quem ganha é o banco — e o sintoma
 * seria um formulário que aceita e uma gravação que recusa.
 */
export const roleKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, { message: "A identificação precisa de ao menos 2 caracteres." })
  .max(31, { message: "Use no máximo 31 caracteres." })
  .regex(/^[a-z][a-z0-9-]*$/, {
    message: "Comece por letra e use apenas letras minúsculas, números e hífen.",
  });

const rotulo = z
  .string()
  .trim()
  .min(2, { message: "Informe o nome do cargo." })
  .max(60, { message: "Use no máximo 60 caracteres." });

const descricao = z
  .string()
  .trim()
  .max(300, { message: "Use no máximo 300 caracteres." })
  .optional()
  .transform((v) => (v ? v : undefined));

/**
 * ⚠️ LISTA VAZIA É PERMITIDA, e não é descuido. Um cargo sem permissão nenhuma
 * é exatamente o "Visualização": a pessoa entra, aparece no diretório interno e
 * não abre nenhum módulo. Recusar o vazio obrigaria a inventar uma permissão
 * para um cargo cujo propósito é não ter nenhuma.
 */
const permissoes = z
  .array(
    z.enum(PERMISSION_VALUES, {
      errorMap: () => ({ message: "Permissão desconhecida. Recarregue a página." }),
    }),
  )
  .max(ALL_PERMISSIONS.length, { message: "Permissões repetidas." });

export const createRoleSchema = z.object({
  key: roleKeySchema,
  label: rotulo,
  description: descricao,
  /**
   * ⚠️ O PAPEL-BASE É ESCOLHIDO AGORA E NUNCA MAIS. Trocá-lo depois mudaria em
   * silêncio o que a RLS entrega a todo mundo que já tem o cargo — a mesma
   * pessoa, no mesmo cargo, passando a ler outras tabelas sem que nada na tela
   * dissesse isso. Quem errou a base cria outro cargo e move as pessoas.
   */
  baseRole: z.enum(VALID_ROLES, {
    errorMap: () => ({ message: "Selecione o papel-base do cargo." }),
  }),
  permissions: permissoes,
});

export type CreateRoleInput = z.input<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  key: roleKeySchema,
  label: rotulo,
  description: descricao,
  permissions: permissoes,
});

export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

export const deleteRoleSchema = z.object({ key: roleKeySchema });

export type DeleteRoleInput = z.input<typeof deleteRoleSchema>;

export const setUserRoleKeySchema = z.object({
  userId: z.string().uuid(),
  roleKey: roleKeySchema,
});

export type SetUserRoleKeyInput = z.input<typeof setUserRoleKeySchema>;

/**
 * Sugere a identificação a partir do nome digitado.
 *
 * ⚠️ SUGERE, NÃO IMPÕE — o campo continua editável. "Secretaria Executiva" vira
 * `secretaria-executiva`, que é legível numa trilha de auditoria e numa consulta
 * SQL. Gerar um uuid seria mais simples e deixaria o histórico ilegível.
 */
export function suggestRoleKey(label: string): string {
  return (
    label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      // O CHECK do banco exige começar por letra: "3-turno" viraria uma recusa
      // depois de a pessoa ter preenchido o formulário inteiro.
      .replace(/^[0-9-]+/, "")
      .slice(0, 31)
      .replace(/-+$/, "")
  );
}
