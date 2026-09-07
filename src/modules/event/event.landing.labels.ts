import type { LandingTemplateVariable } from "./event.landing.rules";
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
  // Sem "reabra": não há o que reabrir. O evento aconteceu, e a página existe
  // agora como registro de quem veio.
  eventPassed: "O evento já aconteceu. As inscrições fecharam sozinhas.",
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
  // ⚠️ DIZ QUE MUDARAM OS DADOS, e não QUAIS ficaram. A trilha guarda só os
  // NOMES dos campos alterados — nunca os valores —, porque copiar e-mail ou
  // telefone para uma tabela append-only criaria uma segunda cópia do dado
  // pessoal que ninguém lembraria de apagar num pedido de exclusão (§25).
  participant_updated: "Dados do participante alterados",
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
  /**
   * ⚠️ "CSP", E NÃO MAIS "CSPI". Este texto é o `alt` do logo, ou seja: o que
   * uma pessoa que não enxerga a imagem ouve no lugar dela. O desenho que
   * chegou escreve **CSP**, e é assim que a marca aparece no nome do evento e
   * no rodapé que o próprio cliente ditou. Um `alt` que diz uma sigla diferente
   * da que está desenhada descreve outra coisa.
   */
  program: "CSP",
  /**
   * O rodapé, palavra por palavra como foi pedido.
   *
   * ⚠️ O ANO ESTÁ FIXO, e é uma escolha a rever em janeiro. `2026` foi ditado
   * assim; derivar de `new Date()` mudaria sozinho na virada do ano — o que
   * costuma ser o desejado num aviso de direitos, mas é uma decisão de quem
   * responde pela marca, não uma esperteza para tomar de surpresa.
   */
  copyright: "© APCS | CSP 2026 - Todos os direitos reservados",
  /** Para onde os dois logos do cabeçalho levam. */
  website: "https://apcs.com.br/",
} as const;

/* -------------------------------------------------------------------------- */
/* Builder (§6 a §28 do Prompt 2)                                             */
/* -------------------------------------------------------------------------- */

/**
 * As variáveis da mensagem de confirmação, com o que cada uma significa.
 *
 * ⚠️ EXISTE PARA A LISTA APARECER NA TELA. O §18 proíbe variável arbitrária —
 * e a única forma de isso não virar tentativa e erro é o Builder MOSTRAR quais
 * existem, ao lado do campo em que se digita.
 */
export const LANDING_TEMPLATE_VARIABLE_LABELS: Record<LandingTemplateVariable, string> = {
  event_name: "Nome do evento",
  event_date: "Data do evento",
  event_start_time: "Hora de início",
  event_end_time: "Hora de término",
};

/** O que cada comando do Builder faz, dito antes de a pessoa confirmar. */
export const LANDING_CONFIRMATION_COPY: Record<"publish" | "close" | "deactivate", string> = {
  publish:
    "A página fica no ar no endereço público e passa a aceitar inscrições. Confira a prévia antes.",
  close:
    "A página continua no ar, mas para de aceitar inscrições. Quem já se inscreveu não é afetado.",
  deactivate:
    "A página sai do ar e o endereço deixa de abrir. Nada é apagado — as inscrições continuam no sistema.",
};

/**
 * ⚠️ O AVISO DO §25, e ele é a regra inteira em duas frases.
 *
 * Não há versionamento de Landing Page (o Prompt 1 não criou um, e o §25 é
 * explícito em não inventar um agora). O que protege o histórico é outra coisa:
 * inscrição gravada é imutável. Editar a página muda o que os PRÓXIMOS verão,
 * nunca o que os anteriores preencheram.
 */
export const LANDING_PUBLISHED_EDIT_WARNING =
  "Esta página está no ar e já recebeu inscrições. Alterações valem para quem se inscrever a partir de agora — nada do que já foi preenchido muda.";

/* -------------------------------------------------------------------------- */
/* A página pública (§27, §28, §30, §31 do Prompt 3)                          */
/* -------------------------------------------------------------------------- */

/**
 * Os textos que gente de FORA da APCS lê.
 *
 * ⚠️ ELES SEGUEM UMA REGRA QUE OS DO BACKOFFICE NÃO SEGUEM: nenhum manda fazer
 * algo que só a APCS pode fazer. "Aumente o limite para aceitar mais gente" é
 * uma instrução perfeita para quem administra o evento e um absurdo para quem
 * queria se inscrever — comparar com `LANDING_STATUS_REASON_LABELS` mostra as
 * duas vozes lado a lado.
 *
 * ⚠️ E NENHUM DELES EXPLICA O SISTEMA. "Vagas esgotadas" não diz quantas eram,
 * "inscrições encerradas" não diz quando encerrou. Uma página aberta na
 * internet não deve ensinar a própria mecânica a quem estiver olhando (§30:
 * nada de stack trace, SQL, id interno ou mensagem técnica).
 */
export const PUBLIC_LANDING_COPY = {
  formTitle: "Inscrição",
  companyLegend: "Granja / Empresa",
  participantLegend: (posicao: number) => `Participante ${posicao}`,
  addParticipant: "Adicionar participante",
  removeParticipant: (posicao: number) => `Remover participante ${posicao}`,
  submit: "Confirmar inscrição",
  submitting: "Enviando...",

  /** §27 — a página continua visível; o formulário não. */
  closedTitle: "Inscrições encerradas",
  closedMessage: "As inscrições para este evento não estão mais disponíveis.",

  /** §28 — a mesma forma, motivo diferente. */
  soldOutTitle: "Vagas esgotadas",
  soldOutMessage: "Este evento atingiu o limite máximo de participantes.",

  /**
   * O aviso de vagas, quando ainda há. Aparece só perto do fim: dizer "restam
   * 180 de 200" no primeiro dia não informa nada e ocupa a linha mais visível
   * do formulário.
   */
  seatsLeft: (vagas: number) =>
    vagas === 1 ? "Resta 1 vaga para este evento." : `Restam ${vagas} vagas para este evento.`,

  /** §29 — o prazo, dito antes de a pessoa começar a preencher. */
  deadline: (quando: string) => `Inscrições até ${quando}.`,

  contactHint: "Informe telefone ou WhatsApp.",

  /** §35 — o consentimento, no vocabulário do formulário de associação. */
  consentLead: "Proteção de dados",

  /**
   * §30 — o erro que sobra quando nenhum código de negócio se aplica.
   *
   * ⚠️ MANDA TENTAR DE NOVO E DIZ QUE OS DADOS CONTINUAM ALI. As duas metades
   * importam: sem a segunda, a pessoa que perdeu a conexão recomeça do zero um
   * formulário com cinco participantes — ou desiste.
   */
  genericError:
    "Não foi possível concluir sua inscrição. Tente novamente — o que você preencheu continua aqui.",

  networkError:
    "Não foi possível enviar. Verifique sua conexão e tente novamente — o que você preencheu continua aqui.",
} as const;

/**
 * O que a página responde quando o endereço não leva a lugar nenhum (§5).
 *
 * ⚠️ UM TEXTO SÓ PARA TRÊS CAUSAS — slug inexistente, página em rascunho,
 * página inativada. É a mesma decisão de `getPublicLandingPage` devolver `null`
 * para os três: distinguir "não existe" de "existe mas está oculta" confirmaria
 * a existência de um evento que ninguém deveria saber que está sendo preparado.
 */
export const PUBLIC_LANDING_NOT_FOUND = {
  title: "Página não encontrada",
  message:
    "O endereço que você abriu não corresponde a nenhuma inscrição disponível. Confira o link recebido.",
} as const;
