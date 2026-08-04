/**
 * Contrato de erro das Server Actions.
 *
 * Toda action de escrita retorna `ActionResult<T>` — NUNCA lança (throw). A UI
 * inspeciona `result.ok` e mostra a mensagem traduzida. Mensagens cruas do
 * banco nunca chegam ao usuário (podem vazar nomes de tabela/constraint).
 *
 * Veja docs/SERVICE-ACTION-PATTERN.md.
 */

export type ActionErrorCode =
  | "uniqueViolation" // 23505 — registro duplicado
  | "hasRelated" // 23503 — há registros dependentes (FK)
  | "invalidInput" // validação (Zod ou CHECK do banco)
  | "forbidden" // sem permissão (RBAC ou RLS bloqueou)
  | "notFound" // registro não encontrado
  | "unexpected"; // erro não previsto (logar no servidor!)

export interface ActionErrorBody {
  code: ActionErrorCode;
  /** Discriminante opcional — ex: nome da constraint violada. */
  constraint?: string;
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionErrorBody };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(code: ActionErrorCode, constraint?: string): ActionResult<never> {
  return { ok: false, error: { code, constraint } };
}

/** Mensagens PT-BR estáveis por código de erro — usadas pela UI. */
export const ACTION_ERROR_MESSAGES: Record<ActionErrorCode, string> = {
  uniqueViolation: "Já existe um registro com esses dados.",
  hasRelated: "Não é possível concluir: há registros vinculados.",
  invalidInput: "Dados inválidos. Verifique os campos e tente novamente.",
  forbidden: "Você não tem permissão para esta ação.",
  notFound: "Registro não encontrado.",
  unexpected: "Ocorreu um erro inesperado. Tente novamente.",
};

type PostgresLikeError = {
  code?: string;
  message?: string;
  details?: string | null;
  constraint?: string;
};

/**
 * Traduz um erro do Supabase/Postgres para um `ActionErrorBody`. Se não for
 * reconhecível, cai em `unexpected` e o caller DEVE logar no servidor.
 */
export function mapPostgresError(err: unknown): ActionErrorBody {
  if (!err || typeof err !== "object") return { code: "unexpected" };
  const e = err as PostgresLikeError;

  switch (e.code) {
    case "23505":
      return { code: "uniqueViolation", constraint: e.constraint };
    case "23503":
      return { code: "hasRelated", constraint: e.constraint };
    case "23514":
      return { code: "invalidInput", constraint: e.constraint };
    case "42501":
      return { code: "forbidden" };
    case "PGRST116":
      return { code: "notFound" };
    default:
      return { code: "unexpected" };
  }
}
