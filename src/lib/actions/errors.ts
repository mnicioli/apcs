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
  // Upload de arquivo. São códigos próprios porque `invalidInput` não distingue
  // "mande um PDF" de "o arquivo está grande demais" de "tire a senha" — e a
  // diferença entre eles é exatamente o que a pessoa precisa saber para
  // conseguir enviar o documento na segunda tentativa.
  | "fileNotPdf"
  | "fileTooLarge"
  | "fileEncrypted"
  | "fileNotImage"
  // Regras de negócio de Eventos. Códigos próprios porque cada uma tem um texto
  // que diz à pessoa O QUE FAZER — "dados inválidos" mandaria procurar o campo
  // errado num formulário de nove campos.
  | "eventExpired"
  | "eventDateInPast"
  | "invalidSegment"
  // Regras de negócio da Bolsa. Mesmo raciocínio: cada uma tem um texto que diz
  // O QUE FAZER em seguida.
  | "bulletinNeedsActiveVersion"
  | "versionNotInBulletin"
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
  fileNotPdf: "Apenas arquivos PDF são permitidos.",
  fileTooLarge: "O arquivo não pode ultrapassar o tamanho máximo de 5 MB.",
  // Diz o que FAZER, e não só o que é proibido: quem recebeu um PDF com senha
  // de outra pessoa precisa saber que o caminho é regravar o arquivo.
  fileEncrypted:
    "O PDF informado é protegido por senha e não pode ser utilizado. Remova a proteção e envie o arquivo novamente.",
  fileNotImage: "Envie uma imagem JPG, PNG ou WEBP válida.",
  eventExpired: "Não é possível ativar um evento cuja data já passou.",
  eventDateInPast: "Não é possível cadastrar um evento com data anterior à data atual.",
  invalidSegment: "Selecione um público-alvo válido.",
  bulletinNeedsActiveVersion:
    "A Bolsa não pode ficar sem uma publicação ativa. Para trocar a publicação oficial, ative a desejada — a atual sai do ar automaticamente.",
  versionNotInBulletin: "Esta publicação não pertence a esta Bolsa.",
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
    // `no_data_found`, levantado pelas funções transacionais de documentos e de
    // eventos quando o id não existe. Sem este caso viraria "erro inesperado", e
    // a tela pediria para tentar de novo algo que nunca vai funcionar.
    case "P0002":
      return { code: "notFound" };
    // Classe `EV` — regras de negócio de Eventos, levantadas pelas funções do
    // Postgres. A classe é própria porque a `P0` é RESERVADA pelo PL/pgSQL: o
    // P0004 é `assert_failure`, que `exception when others` não captura. Ver
    // supabase/migrations/20260813000200_fix_event_error_codes.sql.
    case "EV001":
      return { code: "eventExpired" };
    case "EV002":
      return { code: "invalidSegment" };
    case "EV003":
      return { code: "eventDateInPast" };
    // Classe `MB` — regras de negócio da Bolsa, pela mesma razão da `EV`: a
    // classe `P0` é RESERVADA pelo PL/pgSQL. Ver
    // supabase/migrations/20260814000000_create_market_bulletins.sql.
    case "MB001":
      return { code: "bulletinNeedsActiveVersion" };
    case "MB002":
      return { code: "versionNotInBulletin" };
    default:
      return { code: "unexpected" };
  }
}
