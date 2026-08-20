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
  // Regras de negócio de Palestras. Mesmo raciocínio: "dados inválidos" mandaria
  // procurar o campo errado, enquanto cada uma destas diz o que fazer.
  | "lectureTransitionNotAllowed"
  | "lectureFieldImmutable"
  | "lectureStatusBlocksAction"
  | "lectureReasonRequired"
  | "lectureNeedsTime"
  | "lectureProfileNotFound"
  // Regras de negócio de Enquetes. Mesmo raciocínio: cada uma diz O QUE FAZER
  // em seguida, e "dados inválidos" mandaria procurar o campo errado.
  | "surveyTransitionNotAllowed"
  | "surveyHasResponses"
  | "surveyStatusBlocksAction"
  | "surveyInvalidWindow"
  | "surveyNeedsQuestion"
  | "surveyEmptyAudience"
  | "surveyDimensionUnavailable"
  | "surveyIsAnonymous"
  | "surveyInvalidBatch"
  | "surveyContextInvalid"
  // Regras de negócio de Associados. Mesmo raciocínio de sempre: cada uma diz
  // O QUE FAZER em seguida — e `membershipRateLimited` chega num formulário
  // PÚBLICO, onde "dados inválidos" mandaria a pessoa procurar um campo errado
  // num formulário que estava certo.
  | "membershipTransitionNotAllowed"
  | "membershipStatusBlocksAction"
  | "membershipProfileFieldMissing"
  | "membershipRateLimited"
  | "membershipReasonRequired"
  // Caixa de entrada do WhatsApp. Códigos próprios porque o atendente está com
  // a mensagem escrita na tela e precisa saber se o problema é dele (o texto),
  // do associado (o número) ou do sistema (a integração) — as três reações são
  // diferentes, e "dados inválidos" não distingue nenhuma.
  | "whatsappNotConfigured"
  | "whatsappSendFailed"
  | "whatsappEmptyMessage"
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
  // Diz o CAMINHO possível, não só o que foi barrado: o fluxo de palestras só
  // avança, então quem tentou voltar precisa saber que a saída é cancelar.
  lectureTransitionNotAllowed:
    "Esta mudança de situação não é permitida. O fluxo só avança — se a palestra não vai mais acontecer como está, cancele informando o motivo.",
  lectureFieldImmutable: "Protocolo, origem e data da solicitação não podem ser alterados.",
  lectureStatusBlocksAction: "A situação atual da palestra não permite esta operação.",
  lectureReasonRequired: "Informe o motivo para concluir esta operação.",
  lectureNeedsTime: "Informe o horário de início para confirmar a palestra.",
  lectureProfileNotFound: "Usuário não encontrado.",
  // Enquetes. Cada texto diz o CAMINHO possível, não só o que foi barrado.
  surveyTransitionNotAllowed:
    "Esta mudança de situação não é permitida. Uma enquete encerrada ou cancelada não volta atrás.",
  surveyHasResponses:
    "Esta enquete já recebeu respostas: a pergunta, as alternativas e o anonimato não podem mais ser alterados.",
  surveyStatusBlocksAction: "A situação atual da enquete não permite esta operação.",
  surveyInvalidWindow:
    "Confira as datas: o encerramento deve ser posterior ao início, e o envio não pode ser anterior ao início.",
  surveyNeedsQuestion: "Informe a pergunta e ao menos duas alternativas.",
  surveyEmptyAudience:
    "A segmentação escolhida não alcança nenhum contato com telefone cadastrado. Revise o público-alvo.",
  // Diz o que falta E o que dá para usar hoje — ver o GAP 1 em docs/ENQUETES.md.
  surveyDimensionUnavailable:
    "A segmentação por Segmento, Categoria ou Carteira depende do cadastro de associados, que ainda não existe no sistema. Use Região, Perfil, contatos específicos ou Toda a base.",
  surveyIsAnonymous:
    "Esta enquete é anônima: os participantes não podem ser identificados. Os resultados continuam disponíveis por alternativa.",
  // Os dois abaixo vêm da mensageria (PROMPT 3/3) e, hoje, só de caminhos que
  // o servidor chama — worker e webhook. Estão mapeados assim mesmo: um código
  // do banco sem tradução vira "erro inesperado" na tela, que é a mensagem que
  // não deixa ninguém descobrir o que fazer.
  surveyInvalidBatch: "O tamanho do lote de disparo é inválido.",
  surveyContextInvalid:
    "Não foi possível identificar a conversa desta enquete. Tente novamente em instantes.",
  // Associados. O texto do limite de taxa é o único deste arquivo escrito para
  // alguém que NÃO trabalha na APCS — ele aparece na landing pública. Por isso
  // não fala em "limite", "IP" nem "bloqueio": diz o que fazer e nada mais.
  membershipTransitionNotAllowed:
    "Esta mudança de situação não é permitida. Uma solicitação aprovada não volta atrás — para desfazer, inative o associado no registro.",
  membershipStatusBlocksAction: "A situação atual da solicitação não permite esta operação.",
  membershipProfileFieldMissing:
    "Faltam informações obrigatórias para o perfil escolhido. Revise os campos destacados.",
  membershipRateLimited:
    "Recebemos vários envios deste acesso nos últimos minutos. Aguarde um pouco e tente novamente.",
  membershipReasonRequired: "Informe o motivo da recusa.",
  // WhatsApp. A primeira é para quem cuida do sistema; as outras duas, para
  // quem está com a mensagem escrita e o dedo no botão.
  whatsappNotConfigured:
    "O WhatsApp ainda não está integrado, então nada entra nem sai por aqui. Fale com quem cuida do sistema.",
  whatsappSendFailed:
    "Não foi possível entregar a mensagem. Ela ficou marcada como não entregue na conversa — tente novamente em instantes.",
  whatsappEmptyMessage: "Escreva a mensagem antes de enviar.",
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
    // Classe `PL` — regras de negócio de Palestras, pela mesma razão da `EV` e
    // da `MB`: a classe `P0` é RESERVADA pelo PL/pgSQL. Ver
    // supabase/migrations/20260816000000_create_lectures.sql.
    case "PL001":
      return { code: "lectureTransitionNotAllowed" };
    case "PL002":
      return { code: "lectureFieldImmutable" };
    case "PL003":
      return { code: "lectureStatusBlocksAction" };
    case "PL004":
      return { code: "lectureReasonRequired" };
    case "PL005":
      return { code: "lectureNeedsTime" };
    case "PL006":
      return { code: "lectureProfileNotFound" };
    // Classe `SV` — regras de negócio de Enquetes, pela mesma razão da `EV`, da
    // `MB` e da `PL`: a classe `P0` é RESERVADA pelo PL/pgSQL. Ver
    // supabase/migrations/20260819000000_create_surveys.sql.
    // Classe `MA` — regras de negócio de Associados, pela mesma razão das
    // anteriores: a classe `P0` é RESERVADA pelo PL/pgSQL. Ver
    // supabase/migrations/20260821000000_create_membership.sql.
    case "MA001":
      return { code: "membershipTransitionNotAllowed" };
    case "MA002":
      return { code: "membershipStatusBlocksAction" };
    case "MA003":
      return { code: "membershipProfileFieldMissing" };
    case "MA004":
      return { code: "membershipRateLimited" };
    case "MA005":
      return { code: "membershipReasonRequired" };
    // Classe `WA` — a caixa de entrada do WhatsApp, pela mesma razão das
    // anteriores: a classe `P0` é RESERVADA pelo PL/pgSQL. Ver
    // supabase/migrations/20260822000000_create_whatsapp_inbox.sql.
    case "WA002":
      return { code: "whatsappEmptyMessage" };
    // WA003 (mensagem sem conversa) só acontece no caminho do webhook, onde não
    // há tela. Mapeado assim mesmo: um código sem tradução vira "erro
    // inesperado", que é a mensagem que não deixa ninguém descobrir o que fazer.
    case "WA003":
      return { code: "invalidInput" };
    case "SV001":
      return { code: "surveyTransitionNotAllowed" };
    case "SV002":
      return { code: "surveyHasResponses" };
    case "SV003":
      return { code: "surveyStatusBlocksAction" };
    case "SV004":
      return { code: "surveyInvalidWindow" };
    case "SV005":
      return { code: "surveyNeedsQuestion" };
    case "SV006":
      return { code: "surveyEmptyAudience" };
    case "SV007":
      return { code: "surveyDimensionUnavailable" };
    case "SV008":
      return { code: "surveyIsAnonymous" };
    case "SV009":
      return { code: "surveyInvalidBatch" };
    case "SV010":
      return { code: "surveyContextInvalid" };
    default:
      return { code: "unexpected" };
  }
}
