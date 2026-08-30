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
  | "dbPrivilege" // o BANCO recusou por privilégio de tabela/coluna — não é o papel de quem clicou
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
  | "eventNotActiveForDispatch"
  | "eventExpiredForDispatch"
  | "eventWithoutSegments"
  | "invalidDispatchBatch"
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
  // Os dois abaixo poderiam ser `uniqueViolation`, e não são de propósito: a
  // edição do cadastro tem vinte campos, e "já existe um registro com esses
  // dados" mandaria procurar em todos eles qual foi o que colidiu.
  | "membershipEmailTaken"
  | "membershipCodeTaken"
  // Reativar notificações. Código próprio porque a frase precisa dizer que o
  // que falta não é "um campo": é o registro de quem autorizou.
  | "membershipConsentRequired"
  // Administração. Códigos próprios porque, nestes quatro, a solução NÃO está
  // no sistema nem no formulário: convite que não sai é SMTP do Supabase, e
  // "erro inesperado" mandaria a pessoa tentar de novo para sempre.
  | "inviteFailed"
  | "lastAdmin"
  | "cannotChangeOwnRole"
  | "consentVersionExists"
  | "cannotDeactivateSelf"
  | "lastActiveAdmin"
  | "emailInUse"
  | "broadcastNoAudience"
  | "broadcastEmptyBody"
  | "broadcastUnknownSegment"
  | "broadcastNotReady"
  | "retiredRole"
  // Cargos. Cada um diz O QUE FAZER em seguida, e `roleAboveCeiling` diz a
  // regra inteira porque ela não é óbvia: um cargo só TIRA do papel-base.
  | "roleKeyInvalid"
  | "roleKeyTaken"
  | "roleAboveCeiling"
  | "roleBuiltinLocked"
  | "roleInUse"
  | "lastUserManager"
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
  dbPrivilege:
    "O banco recusou esta gravação por configuração interna — não é o seu perfil. " +
    "Avise quem cuida do sistema: o log do servidor diz qual coluna faltou liberar.",
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
  // ⚠️ MENSAGENS PRÓPRIAS, e não reúso de `eventExpired`. Aquela diz "não é
  // possível ATIVAR um evento cuja data já passou" — mostrá-la a quem clicou
  // em "Divulgar" mandaria a pessoa procurar um botão de ativar que não é o
  // problema. O código é diferente porque a frase precisa ser diferente.
  eventNotActiveForDispatch: "Ative o evento antes de divulgar.",
  eventExpiredForDispatch: "Este evento já passou e não pode ser divulgado.",
  eventWithoutSegments: "Defina o público-alvo do evento antes de divulgar.",
  invalidDispatchBatch: "O lote de divulgação está fora do tamanho permitido.",
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
    "A segmentação escolhida não alcança nenhum associado ativo com WhatsApp cadastrado. Revise o público-alvo.",
  // Diz o que não vale mais E o que usar no lugar — ver a seção 4 de
  // docs/ENQUETES.md. Perfil entrou nesta lista em 09/09: ele virou o
  // Público-alvo na unificação de perfis.
  surveyDimensionUnavailable:
    "A segmentação por Perfil, Categoria ou Carteira não está disponível. Use Público-alvo, Região, associados específicos ou Toda a base.",
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
  membershipEmailTaken:
    "Este e-mail já pertence a outro associado. O registro não aceita o mesmo e-mail duas vezes.",
  membershipCodeTaken: "Esta matrícula já pertence a outro associado.",
  inviteFailed:
    "Não foi possível enviar o convite. Confira se o envio de e-mail está configurado no projeto Supabase (Authentication → SMTP).",
  lastAdmin:
    "O sistema precisa de pelo menos um administrador. Promova outra pessoa antes de alterar este papel.",
  cannotChangeOwnRole: "Você não pode alterar o próprio papel. Peça a outro administrador.",
  cannotDeactivateSelf: "Você não pode inativar a própria conta. Peça a outro administrador.",
  // ⚠️ Fala em admin ATIVO, e não só "administrador": o sistema pode ter dois
  // cadastrados com um deles desligado, e nesse caso ele tem UM. A mensagem
  // precisa explicar por que o número na tela não bate com a recusa.
  lastActiveAdmin:
    "O sistema precisa de pelo menos um administrador ativo. Ative ou promova outra pessoa antes.",
  emailInUse: "Já existe uma conta com este e-mail.",
  retiredRole: "Este papel foi aposentado e não pode mais ser atribuído. Recarregue a página.",
  roleKeyInvalid:
    "A identificação do cargo deve começar por letra e usar apenas letras minúsculas, números e hífen.",
  roleKeyTaken: "Já existe um cargo com esta identificação. Escolha outra.",
  roleAboveCeiling:
    "Esta permissão não existe no papel-base do cargo. Um cargo só pode TIRAR do papel-base, nunca acrescentar — para dar este acesso, escolha outro papel-base ao criar o cargo.",
  roleBuiltinLocked:
    "Os cargos originais do sistema não podem ser alterados aqui. Crie um cargo novo apoiado neste e retire o que não deve abrir.",
  roleInUse: "Há pessoas com este cargo. Mova essas pessoas para outro cargo antes de excluí-lo.",
  lastUserManager:
    "Isto deixaria o sistema sem ninguém capaz de administrar usuários. Dê o acesso a outra pessoa antes.",
  broadcastNoAudience: "Escolha ao menos um público-alvo antes de divulgar.",
  broadcastEmptyBody: "A mensagem ficou vazia. Confira se o registro tem os dados necessários.",
  broadcastUnknownSegment:
    "Um dos públicos escolhidos não existe mais ou foi desativado. Recarregue a página.",
  // ⚠️ Diz O QUE FALTA, e não só "não pode". Sem versão ativa, divulgar
  // mandaria a base atrás de um arquivo que a APCS tirou do ar de propósito.
  broadcastNotReady:
    "Não há o que divulgar: publique uma versão ativa (ou confirme a palestra) antes.",
  consentVersionExists:
    "Esta versão já existe e não pode ser reescrita — uma autorização vale só para o texto que a pessoa leu. Publique com uma versão nova.",
  membershipConsentRequired:
    "Registre quem pediu para voltar a receber e por onde — é esse registro que autoriza a APCS a mandar mensagem de novo.",
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
  hint?: string | null;
  constraint?: string;
};

/**
 * TRADUZ O ERRO DO BANCO **E O REGISTRA** — nesta ordem, e sempre juntos.
 *
 * ⚠️ NASCEU DE UM DEFEITO REAL, e vale contar qual: uma divulgação por WhatsApp
 * falhava com "Ocorreu um erro inesperado. Tente novamente." e **não deixava uma
 * única linha no log do servidor**. O caller fazia
 * `return fail(mapPostgresError(error).code)`, e `mapPostgresError` transforma
 * qualquer código que ele não conhece em `unexpected` — a mensagem certa para a
 * tela e a pior possível para quem vai investigar. A falha chegava ao usuário e
 * desaparecia do servidor ao mesmo tempo, então não havia por onde começar.
 *
 * O comentário de `mapPostgresError` já dizia "o caller DEVE logar". Depender de
 * cada caller lembrar disso é como um deles esquece — e o esquecimento só
 * aparece no dia em que alguém precisa do log e ele não existe. Aqui as duas
 * coisas acontecem numa chamada só.
 *
 * ⚠️ REGISTRA TODA FALHA DE ESCRITA, e não só as desconhecidas. Um `forbidden`
 * ou um `BC003` também são perguntas legítimas ("por que ele disse que não
 * posso?"), e uma linha por operação que falhou não é volume: estas são ações de
 * backoffice, não um endpoint de tráfego.
 *
 * ⚠️ O QUE NUNCA SAI DAQUI PARA A TELA: `message`, `details` e `hint` do
 * Postgres. Eles vão SÓ para o log do servidor — o retorno continua sendo o
 * código traduzido. Ver o teste que garante que caminho de arquivo e credencial
 * não vazam numa mensagem de erro.
 */
export function failFromPostgres(
  /** Prefixo greppável do log, no padrão do projeto: `broadcast.start`. */
  escopo: string,
  err: unknown,
  /** O que estava sendo feito — ids, origem. NUNCA dados pessoais. */
  contexto: Record<string, unknown> = {},
): ActionResult<never> {
  const mapeado = mapPostgresError(err);
  const e = (err ?? {}) as PostgresLikeError;

  console.error(`[${escopo}] o banco recusou a operação:`, {
    ...contexto,
    traduzido: mapeado.code,
    code: e.code,
    message: e.message,
    details: e.details,
    hint: e.hint,
    constraint: e.constraint,
  });

  return fail(mapeado.code, mapeado.constraint);
}

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
    /**
     * ⚠️ 42501 SÃO DUAS COISAS, e confundi-las custou uma investigação inteira.
     *
     *   1. "o seu papel não pode" — uma policy de RLS ou um `raise` nosso. É o
     *      `forbidden`, e a mensagem manda a pessoa falar com quem dá acesso.
     *   2. "esta COLUNA não é sua" — um `grant update (...)` que não inclui a
     *      coluna sendo escrita. Não tem nada a ver com o papel de quem clicou:
     *      é configuração do banco, e nenhum ajuste na Matriz de Acesso
     *      resolve.
     *
     * Aconteceu de verdade: `events.description` nasceu sem grant, e um
     * ADMINISTRADOR com 33 de 33 permissões via "Você não tem permissão para
     * esta ação" ao salvar um evento. A mensagem mandava procurar no RBAC, que
     * estava certo o tempo todo.
     *
     * A distinção é pelo texto porque o Postgres não dá códigos diferentes. É
     * seguro aqui: as mensagens de privilégio são do próprio Postgres, em
     * inglês (o Supabase roda com `lc_messages` em C), enquanto todo `raise`
     * deste projeto é em português.
     */
    case "42501":
      return /permission denied for (table|column|relation|schema|sequence|function)/i.test(
        e.message ?? "",
      )
        ? { code: "dbPrivilege" }
        : { code: "forbidden" };
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
    // EV004..EV007 — a divulgação. Ver 20260828205853_event_dispatch.sql.
    case "EV004":
      return { code: "eventNotActiveForDispatch" };
    case "EV005":
      return { code: "eventExpiredForDispatch" };
    case "EV006":
      return { code: "eventWithoutSegments" };
    case "EV007":
      return { code: "invalidDispatchBatch" };
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
    // MA006/MA007 — a edição do cadastro. Ver 20260829140100_update_member.sql.
    case "MA006":
      return { code: "membershipEmailTaken" };
    case "MA007":
      return { code: "membershipCodeTaken" };
    // MA008 — a reativação. Ver 20260829180100_resume_notifications.sql.
    case "MA008":
      return { code: "membershipConsentRequired" };
    // Classe `AD` — Administração. Ver 20260830100000_admin_module.sql.
    case "AD001":
      return { code: "lastAdmin" };
    case "AD002":
      return { code: "cannotChangeOwnRole" };
    case "AD003":
      return { code: "consentVersionExists" };
    case "AD004":
      return { code: "cannotDeactivateSelf" };
    case "AD005":
      return { code: "lastActiveAdmin" };
    case "AD006":
      return { code: "retiredRole" };
    // Classe `AR` — cargos. Ver 20260903000100_custom_roles.sql.
    case "AR001":
      return { code: "roleKeyInvalid" };
    case "AR002":
      return { code: "roleKeyTaken" };
    case "AR003":
      return { code: "roleAboveCeiling" };
    case "AR004":
      return { code: "roleBuiltinLocked" };
    case "AR005":
      return { code: "roleInUse" };
    case "AR006":
      return { code: "lastUserManager" };
    // Classe `BC` — divulgação genérica. Ver 20260901000100_broadcasts.sql.
    case "BC001":
      return { code: "broadcastNoAudience" };
    case "BC002":
      return { code: "broadcastEmptyBody" };
    case "BC003":
      return { code: "broadcastUnknownSegment" };
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
