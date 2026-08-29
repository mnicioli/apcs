import type {
  MemberOrigin,
  MemberStatus,
  MembershipApplicationStatus,
  MembershipAuditAction,
  MembershipProfileType,
} from "./membership.types";

/**
 * Rótulos PT-BR de Associados. Ficam aqui, e não espalhados pelas telas, para o
 * vocabulário ser um só: se a grid diz "Aguardando", o filtro e o detalhe dizem
 * "Aguardando".
 *
 * É também o único lugar onde `Member` vira "Associado": o código fala inglês,
 * a tela fala português.
 */

export const MEMBERSHIP_MODULE_TITLE = "Associados";

export const MEMBERSHIP_MODULE_SUBTITLE =
  "Quem se cadastrou pelo site e quem a APCS já reconhece como associado.";

export const APPLICATIONS_TITLE = "Solicitações";

export const APPLICATIONS_SUBTITLE =
  "O que chegou pelo formulário público. Nada aqui entra no registro sem alguém aprovar.";

export const MEMBERSHIP_APPLICATION_STATUS_LABELS: Record<MembershipApplicationStatus, string> = {
  pending: "Aguardando",
  in_review: "Em análise",
  approved: "Aprovada",
  rejected: "Recusada",
};

/**
 * O que cada situação significa, em uma frase. Existe porque "Aguardando" e
 * "Em análise" soam parecido para quem chega agora, e a diferença entre elas —
 * ninguém pegou, ou alguém já está com ela — é o que decide o que fazer.
 */
export const MEMBERSHIP_APPLICATION_STATUS_HINTS: Record<MembershipApplicationStatus, string> = {
  pending: "Chegou pelo site e ainda não foi analisada.",
  in_review: "Alguém do time assumiu a análise.",
  approved: "Virou associado no registro da APCS.",
  rejected: "Não foi aceita. Pode ser reaberta se a situação mudar.",
};

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: "Ativo",
  inactive: "Inativo",
  suspended: "Suspenso",
};

export const MEMBER_ORIGIN_LABELS: Record<MemberOrigin, string> = {
  application: "Cadastro pelo site",
  // A carga ainda não foi feita — ver o cabeçalho da migration. O rótulo já
  // existe para a tela não mostrar "import" cru no dia em que ela rodar.
  import: "Carga do cadastro anterior",
  manual: "Cadastro manual",
};

/**
 * ⚠️ SINGULAR AQUI, PLURAL NO PÚBLICO-ALVO — e a diferença tem motivo.
 *
 * Este rótulo descreve UMA pessoa ou organização: aparece no selo de um
 * associado, numa linha da lista. "Criadores" numa linha só ficaria errado.
 * O catálogo `event_segments` usa o plural ("Criadores", "Técnicos") porque
 * ali o nome descreve um GRUPO. São o mesmo perfil, ditos de dois jeitos
 * conforme o que está sendo nomeado.
 */
export const MEMBERSHIP_PROFILE_TYPE_LABELS: Record<MembershipProfileType, string> = {
  criador: "Criador",
  empresa: "Empresa",
  tecnico: "Técnico",
  universidade: "Universidade",
};

export const MEMBERSHIP_AUDIT_ACTION_LABELS: Record<MembershipAuditAction, string> = {
  application_submitted: "Solicitação enviada pelo site",
  application_review_started: "Análise assumida",
  application_approved: "Solicitação aprovada",
  application_rejected: "Solicitação recusada",
  application_reopened: "Solicitação devolvida para a fila",
  member_created: "Associado criado no registro",
  member_linked: "Vinculada a associado já existente",
  member_updated: "Cadastro do associado alterado",
  member_notifications_resumed: "Voltou a receber notificações, a pedido",
};

/**
 * Rótulo de cada campo do cadastro NA TRILHA.
 *
 * ⚠️ Existe separado de `MEMBERSHIP_FIELD_LABELS` porque a trilha nomeia campos
 * que o formulário público nunca teve — situação, matrícula, data de associação
 * e observações só existem no registro. Sem eles, o histórico mostraria
 * "status" e "joinedAt" crus para quem só fala português.
 *
 * A chave é o nome em camelCase que `update_member` grava em
 * `metadata->'changed'`. Um campo novo no SQL sem entrada aqui aparece com o
 * nome cru — feio, mas legível, e é por isso que o acesso abaixo tolera a
 * ausência em vez de quebrar a tela.
 */
export const MEMBER_FIELD_LABELS: Record<string, string> = {
  code: "Matrícula",
  status: "Situação",
  profileType: "Perfil",
  fullName: "Nome",
  whatsapp: "WhatsApp",
  email: "E-mail",
  city: "Cidade",
  state: "Estado",
  organization: "Empresa ou entidade",
  farmName: "Nome da granja",
  productionCity: "Município da produção",
  sowCount: "Número de matrizes",
  cnpj: "CNPJ",
  stateRegistration: "Inscrição estadual",
  activityArea: "Área de atuação",
  jobTitle: "Cargo ou função",
  legalName: "Razão social",
  tradeName: "Nome fantasia",
  interests: "Interesses",
  otherInterest: "Outro interesse",
  joinedAt: "Associado desde",
  notes: "Observações",
};

/** Rótulos dos campos, compartilhados entre o formulário público e o detalhe. */
export const MEMBERSHIP_FIELD_LABELS = {
  fullName: "Nome completo",
  whatsapp: "WhatsApp",
  email: "E-mail",
  city: "Cidade",
  state: "Estado",
  organization: "Empresa ou entidade",
  farmName: "Nome da granja",
  productionCity: "Município da produção",
  sowCount: "Número de matrizes",
  cnpj: "CNPJ",
  stateRegistration: "Inscrição estadual",
  activityArea: "Área de atuação",
  jobTitle: "Cargo ou função",
  legalName: "Razão social",
  tradeName: "Nome fantasia",
  interests: "Interesses",
  otherInterest: "Outro interesse",
} as const;

/* -------------------------------------------------------------------------- */
/* Consentimento (LGPD)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Versão do texto de consentimento, gravada em cada solicitação.
 *
 * Existe porque o texto MUDA, e uma autorização só vale para o que a pessoa
 * leu. Sem a versão, um texto novo em 2027 tornaria impossível saber a que
 * exatamente quem se cadastrou em 2026 disse sim. Ao alterar o texto abaixo,
 * INCREMENTE a versão — não reescreva a antiga.
 */
export const MEMBERSHIP_CONSENT_VERSION = "2026-08-v1";

export const MEMBERSHIP_CONSENT_TEXT =
  "Autorizo a APCS a tratar meus dados para análise do cadastro e comunicação institucional, conforme a Lei Geral de Proteção de Dados.";
