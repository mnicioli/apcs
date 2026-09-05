import type {
  LandingFieldKey,
  LandingPageStatus,
  LandingPageStatusReason,
  ParticipantConfirmation,
  RegistrationAuditAction,
  RegistrationOrigin,
  RegistrationStatus,
} from "./event.landing.types";

/**
 * Rótulos PT-BR de Landing Pages e Inscrições.
 *
 * Ficam aqui, e não espalhados pelas telas, para o vocabulário ser um só: se a
 * grid diz "Publicada", o filtro e o detalhe dizem "Publicada".
 *
 * ⚠️ OS `Record<...>` SÃO A REDE QUE PEGA UM VALOR NOVO VINDO DO POSTGRES. Um
 * valor acrescentado ao enum entra em `src/types/database.ts` no próximo
 * `pnpm db:types`, o `Record` fica incompleto e o type-check quebra — antes de
 * a tela mostrar o valor cru para alguém.
 */

export const LANDING_MODULE_TITLE = "Landing Pages";

export const LANDING_MODULE_SUBTITLE =
  "A página de inscrição de cada evento. Uma por evento, com endereço próprio.";

export const REGISTRATIONS_MODULE_TITLE = "Inscrições";

export const REGISTRATIONS_MODULE_SUBTITLE =
  "Quem se inscreveu nos eventos da APCS. A inscrição é da granja ou empresa; os participantes são as pessoas dela.";

export const LANDING_PAGE_STATUS_LABELS: Record<LandingPageStatus, string> = {
  draft: "Rascunho",
  published: "Publicada",
  closed: "Encerrada",
  inactive: "Inativa",
};

/**
 * O que cada situação significa, em uma frase.
 *
 * Existe porque "Encerrada" e "Inativa" soam parecido para quem chega agora, e
 * a diferença entre elas — parou de aceitar inscrição, ou saiu do ar por
 * completo — é o que decide o que fazer.
 */
export const LANDING_PAGE_STATUS_HINTS: Record<LandingPageStatus, string> = {
  draft: "Ainda não está no ar. Ninguém consegue se inscrever.",
  published: "No ar, aceitando inscrições.",
  closed: "Está no ar, mas não aceita mais inscrições.",
  inactive: "Foi tirada do ar. O endereço não abre mais.",
};

/**
 * POR QUE não aceita inscrição — e cada texto diz o que fazer em seguida.
 *
 * ⚠️ SÃO CINCO MOTIVOS PARA DUAS SITUAÇÕES NA TELA, e é aí que está o valor
 * disto. "Encerrada" sozinha manda a pessoa procurar um botão de reabrir;
 * "lotou" manda aumentar a capacidade; "o prazo venceu" manda estender o prazo.
 * Três reações diferentes atrás do mesmo rótulo.
 */
export const LANDING_STATUS_REASON_LABELS: Record<LandingPageStatusReason, string> = {
  draft: "Ainda em rascunho — publique a página para abrir as inscrições.",
  manual: "Encerrada manualmente.",
  expired: "O prazo de inscrição já venceu. Estenda a data para reabrir.",
  full: "A capacidade máxima foi atingida. Aumente o limite para aceitar mais gente.",
  inactive: "Foi tirada do ar.",
};

export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  active: "Ativa",
  cancelled: "Cancelada",
};

export const PARTICIPANT_CONFIRMATION_LABELS: Record<ParticipantConfirmation, string> = {
  confirmed: "Confirmado",
  not_confirmed: "Não confirmado",
};

/**
 * De onde a inscrição veio.
 *
 * ⚠️ "Cadastro manual" e não "backoffice": quem lê a tela é a APCS, e
 * "backoffice" é palavra de quem escreveu o código. É a mesma escolha de
 * `MEMBER_ORIGIN_LABELS`.
 */
export const REGISTRATION_ORIGIN_LABELS: Record<RegistrationOrigin, string> = {
  landing_page: "Página de inscrição",
  backoffice: "Cadastro manual",
};

export const REGISTRATION_AUDIT_ACTION_LABELS: Record<RegistrationAuditAction, string> = {
  registration_created: "Inscrição registrada",
  registration_updated: "Dados da inscrição alterados",
  registration_cancelled: "Inscrição cancelada",
  registration_reactivated: "Inscrição reativada",
  participant_confirmation_changed: "Confirmação do participante alterada",
};

/**
 * Os campos do formulário, como a APCS os chama.
 *
 * ⚠️ ESTAS SÃO AS ETIQUETAS QUE APARECEM NA PÁGINA PÚBLICA, e é por isso que
 * elas moram aqui e não no Builder: o Prompt 2 desenha a ordem, o Prompt 3
 * renderiza a página, e as duas telas precisam chamar o campo pelo mesmo nome
 * que a pessoa vai ver.
 */
export const LANDING_FIELD_LABELS: Record<LandingFieldKey, string> = {
  GRANJA_EMPRESA: "Granja / Empresa",
  EMAIL: "E-mail",
  NOME_PARTICIPANTE: "Nome do Participante",
  TELEFONE: "Telefone",
  WHATSAPP: "WhatsApp",
};

/** Uma frase por campo, para o Builder explicar o que cada um coleta. */
export const LANDING_FIELD_HINTS: Record<LandingFieldKey, string> = {
  GRANJA_EMPRESA: "Informado uma vez por inscrição. Obrigatório.",
  EMAIL:
    "De cada participante. Obrigatório, e é o que impede a mesma pessoa de se inscrever duas vezes.",
  NOME_PARTICIPANTE: "De cada participante. Obrigatório.",
  TELEFONE: "Opcional — mas cada participante precisa informar telefone ou WhatsApp.",
  WHATSAPP: "Opcional — mas cada participante precisa informar telefone ou WhatsApp.",
};

/**
 * Rótulo de cada campo NA TRILHA.
 *
 * A chave é o nome em camelCase que as funções Postgres gravam em
 * `metadata->'changes'`. Um campo novo no SQL sem entrada aqui aparece com o
 * nome cru — feio, mas legível, e é por isso que o acesso tolera a ausência em
 * vez de quebrar a tela.
 */
export const LANDING_AUDIT_FIELD_LABELS: Record<string, string> = {
  slug: "Endereço da página",
  description: "Descrição",
  formFields: "Campos do formulário",
  closesAt: "Prazo de inscrição",
  maxParticipants: "Capacidade",
  successMessage: "Mensagem de confirmação",
  image: "Imagem",
  companyName: "Granja ou empresa",
  status: "Situação",
};

/* -------------------------------------------------------------------------- */
/* Identidade institucional (§19)                                             */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ ISTO É O §19, E ELE É UMA CONSTANTE DE PROPÓSITO.
 *
 * O escopo pede que a Landing Page pertença ao contexto institucional
 * APCS + CSPI e que o usuário NÃO possa trocar logo, cores ou identidade
 * visual. A forma mais confiável de garantir isso é a identidade não ser um
 * DADO: não há coluna para ela na tabela, não há campo para ela no formulário,
 * e não há como configurá-la pela tela. Ela é isto.
 *
 * A arte do Prompt 3 lê daqui. O que a Landing Page configura é o CONTEÚDO —
 * imagem do evento, descrição, campos, mensagem de sucesso.
 */
export const LANDING_INSTITUTIONAL_CONTEXT = {
  organization: "APCS",
  program: "CSPI",
  /** Como as duas aparecem juntas no cabeçalho e no rodapé da página. */
  signature: "APCS · CSPI",
} as const;
