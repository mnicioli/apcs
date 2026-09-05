import { foldAccents, normalizeForSearch } from "@/lib/utils";
import type {
  ConfirmationFilter,
  LandingFieldKey,
  LandingPageEffectiveStatus,
  LandingPageFilters,
  LandingPageStatus,
  LandingPageStatusReason,
  LandingPageWithEvent,
  LandingSuccessMessage,
  RegistrationFilters,
  RegistrationRow,
} from "./event.landing.types";
import {
  CONTACT_LANDING_FIELD_KEYS,
  LANDING_FIELD_KEYS,
  REQUIRED_LANDING_FIELD_KEYS,
} from "./event.landing.types";

/**
 * As regras de Landing Pages e Inscrições — puras, sem I/O, testáveis uma a uma.
 *
 * ⚠️ O QUE ESTÁ AQUI É A LEITURA DAS REGRAS, NÃO A GARANTIA DELAS.
 *
 * O que precisa valer mesmo com duas telas concorrentes — não aceitar inscrição
 * fora do prazo, não estourar a capacidade, não repetir e-mail no mesmo evento —
 * vive no BANCO, em `create_event_registration`, sob lock. Este arquivo decide o
 * que a tela mostra e o que ela deixa clicar.
 *
 * As duas pontas precisam CONCORDAR, e é por isso que cada função abaixo diz de
 * qual trecho do SQL ela é o espelho. Quando discordarem, quem manda é o banco:
 * a tela pode oferecer um botão que a gravação recusa (chato), mas nunca o
 * contrário (grave).
 *
 * ⚠️ `now` E `participantCount` SÃO INJETADOS, e não lidos aqui dentro. Pelos
 * mesmos dois motivos de `effectiveStatus` em Eventos: o teste não depende da
 * hora em que roda, e a página inteira decide o "agora" uma vez só em vez de
 * cada linha da grid consultar o relógio.
 */

/* -------------------------------------------------------------------------- */
/* Situação efetiva                                                           */
/* -------------------------------------------------------------------------- */

/** O mínimo que basta para decidir se uma página aceita inscrição. */
export interface LandingStatusInput {
  status: LandingPageStatus;
  /** ISO 8601 com fuso, ou `null` quando não há prazo. */
  closesAt: string | null;
  maxParticipants: number | null;
  participantCount: number;
}

/**
 * A situação que VALE agora.
 *
 * A propriedade que faz este desenho funcionar, herdada de Eventos: **a
 * derivação só sabe rebaixar**. Uma página tirada do ar à mão continua fora do
 * ar por mais que sobrem vagas e prazo; a passagem do tempo nunca reabre nada.
 * Por isso "encerramento automático não pode ressuscitar página inativada" não
 * é uma regra a lembrar, é uma impossibilidade estrutural.
 *
 * Espelha a cláusula de `create_event_registration` que recusa página não
 * publicada (LP001) e prazo vencido (RG001).
 */
export function landingEffectiveStatus(
  page: LandingStatusInput,
  now: Date = new Date(),
): LandingPageEffectiveStatus {
  if (page.status !== "published") return page.status;
  if (isPastDeadline(page, now)) return "closed";
  if (isFull(page)) return "closed";
  return "published";
}

/**
 * Por que as inscrições não estão abertas — a informação que a tela precisa
 * para dizer o que fazer.
 *
 * "Encerrada" sozinha manda a pessoa procurar um botão de reabrir; "encerrada
 * porque lotou" manda aumentar a capacidade; "encerrada porque o prazo venceu"
 * manda estender o prazo. São três reações diferentes.
 */
export function landingStatusReason(
  page: LandingStatusInput,
  now: Date = new Date(),
): LandingPageStatusReason | null {
  if (page.status === "draft") return "draft";
  if (page.status === "inactive") return "inactive";
  if (page.status === "closed") return "manual";
  // Publicada: a ordem é a mesma da gravação — prazo antes de capacidade.
  if (isPastDeadline(page, now)) return "expired";
  if (isFull(page)) return "full";
  return null;
}

/**
 * A página aceita inscrição AGORA?
 *
 * ⚠️ ESTA É A PERGUNTA DO §17, e a resposta aqui é apenas a da TELA. A gravação
 * refaz a mesma pergunta dentro da transação, sob o lock da página — porque
 * entre o instante em que a tela decidiu e o instante em que o envio chega,
 * outra pessoa pode ter tomado a última vaga.
 */
export function acceptsRegistrations(page: LandingStatusInput, now: Date = new Date()): boolean {
  return landingEffectiveStatus(page, now) === "published";
}

/** Quantas vagas sobram. `null` = sem limite (§14). Nunca negativo. */
export function seatsLeft(page: LandingStatusInput): number | null {
  if (page.maxParticipants === null) return null;
  return Math.max(page.maxParticipants - page.participantCount, 0);
}

/**
 * Cabem mais `quantity` pessoas?
 *
 * `quantity` e não "cabe mais uma": a capacidade é conferida contra a inscrição
 * INTEIRA. Uma granja mandando cinco funcionários com três vagas livres é
 * recusada por completo — aceitar três e descartar dois deixaria a granja sem
 * saber quem ficou de fora. Espelha a etapa 8 de `create_event_registration`.
 */
export function fitsCapacity(page: LandingStatusInput, quantity: number): boolean {
  const livres = seatsLeft(page);
  return livres === null || quantity <= livres;
}

function isPastDeadline(page: LandingStatusInput, now: Date): boolean {
  if (!page.closesAt) return false;
  const prazo = new Date(page.closesAt);
  // Data ilegível não fecha a página. Uma string corrompida viraria `NaN`, e
  // `NaN` em qualquer comparação é `false` — o que já daria neste resultado,
  // mas por acidente. Aqui é por decisão: o banco continua sendo a barreira, e
  // fechar inscrições por causa de um valor que ninguém consegue ler mandaria
  // gente embora sem motivo.
  if (Number.isNaN(prazo.getTime())) return false;
  return now.getTime() > prazo.getTime();
}

function isFull(page: LandingStatusInput): boolean {
  return page.maxParticipants !== null && page.participantCount >= page.maxParticipants;
}

/* -------------------------------------------------------------------------- */
/* Transições (§5)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * As transições que `set_event_landing_page_status` aceita, escritas para a
 * tela poder esconder o botão em vez de oferecer um erro.
 *
 *     rascunho   → publicada | inativa
 *     publicada  → encerrada | inativa
 *     encerrada  → publicada | inativa
 *     inativa    → publicada
 *
 * ⚠️ ESTA É A CÓPIA DE LEITURA. A autoridade é a função Postgres; se as duas
 * discordarem, o botão aparece e a gravação recusa — que é o lado seguro.
 */
export function canPublishLanding(page: { status: LandingPageStatus }): boolean {
  return page.status !== "published";
}

export function canCloseLanding(page: { status: LandingPageStatus }): boolean {
  return page.status === "published";
}

export function canDeactivateLanding(page: { status: LandingPageStatus }): boolean {
  return page.status !== "inactive";
}

/* -------------------------------------------------------------------------- */
/* Slug (§6)                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * O endereço que a página provavelmente terá.
 *
 * ⚠️ É UMA PRÉVIA, E DE PROPÓSITO NÃO É A AUTORIDADE. Quem decide o slug é
 * `event_landing_free_slug` no Postgres, porque só ele consegue conferir a
 * UNICIDADE — e uma normalização que não decide unicidade não é a fonte de
 * nada. Esta serve para a tela mostrar `/eventos/encontro-tecnico` enquanto a
 * pessoa digita o nome do evento.
 *
 * As duas normalizações concordam nos casos que importam (acento, maiúscula,
 * espaço, pontuação); quando divergirem, o valor gravado é o do banco, e é ele
 * que a tela relê depois de salvar.
 */
export function slugPreview(value: string): string {
  return slugWhileTyping(value).replace(/^-+|-+$/g, "");
}

/**
 * A MESMA NORMALIZAÇÃO, MENOS O CORTE DAS PONTAS.
 *
 * ============================================================================
 * ⚠️ EXISTE POR CAUSA DE UM DEFEITO REAL, ENCONTRADO POR UM TESTE.
 * ============================================================================
 * O campo de endereço do Builder normaliza a cada tecla — é o que faz o que a
 * pessoa vê ser o que vai ser enviado. Com `slugPreview` ali, digitar
 * "Encontro Técnico" produzia **"encontrotecnico"**:
 *
 *   "Encontro"    → "encontro"
 *   "Encontro "   → "encontro-"  → o corte tira o hífen → "encontro"
 *   "Encontro T"  → "encontrot"
 *
 * O separador era apagado no instante entre a barra de espaço e a letra
 * seguinte. Digitar um endereço de duas palavras ficava impossível, e a causa
 * era invisível: cada tecla individualmente parecia funcionar.
 *
 * A correção é separar as duas perguntas. ENQUANTO SE DIGITA, um hífen no fim é
 * uma palavra que ainda não terminou. NO FIM, ele é lixo — e é `slugPreview`
 * que decide isso, na hora de salvar e ao sair do campo.
 *
 * ⚠️ USA `foldAccents`, E NÃO `normalizeForSearch`, e essa é a segunda metade
 * do mesmo defeito. `normalizeForSearch` termina com `.trim()` — o que é certo
 * para uma caixa de busca e fatal aqui: "Encontro " chegava já sem o espaço, e
 * o separador nunca era criado. `foldAccents` é a parte comum (NFD +
 * `\p{Diacritic}` + minúsculas, exatamente os três primeiros passos de
 * `event_landing_slugify` no Postgres) sem a decisão que não é nossa.
 */
export function slugWhileTyping(value: string): string {
  return foldAccents(value)
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-");
}

/** O formato que o CHECK `event_landing_pages_slug_format` aceita. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(value: string): boolean {
  return SLUG_PATTERN.test(value) && value.length >= 3 && value.length <= 120;
}

/* -------------------------------------------------------------------------- */
/* Campos do formulário (§7, §8)                                              */
/* -------------------------------------------------------------------------- */

export type LandingFieldsIssue =
  | "unknownField"
  | "duplicateField"
  | "missingRequired"
  | "missingContact"
  | "empty";

/**
 * A configuração de campos é válida? Devolve o problema, ou `null`.
 *
 * ⚠️ ESPELHA `assert_event_landing_fields` NO POSTGRES, regra por regra. A
 * versão SQL é a que garante; esta existe para o Builder do Prompt 2 poder
 * dizer o que está errado ENQUANTO a pessoa arrasta, em vez de recusar o
 * salvamento no fim.
 *
 * A quarta regra é a que não é óbvia: sem TELEFONE nem WHATSAPP no formulário,
 * nenhum participante conseguiria satisfazer o §8, e a página nasceria incapaz
 * de aceitar uma única inscrição.
 */
export function validateLandingFields(fields: readonly string[]): LandingFieldsIssue | null {
  if (fields.length === 0) return "empty";

  if (fields.some((campo) => !(LANDING_FIELD_KEYS as readonly string[]).includes(campo))) {
    return "unknownField";
  }

  if (new Set(fields).size !== fields.length) return "duplicateField";

  if (!REQUIRED_LANDING_FIELD_KEYS.every((campo) => fields.includes(campo))) {
    return "missingRequired";
  }

  if (!CONTACT_LANDING_FIELD_KEYS.some((campo) => fields.includes(campo))) {
    return "missingContact";
  }

  return null;
}

/**
 * Lê a configuração gravada, defensivamente.
 *
 * `form_fields` é jsonb: o tipo do TypeScript diz `Json`, e o que chega pode ser
 * qualquer coisa se alguém editou a linha por fora. Um valor irreconhecível cai
 * na ordem padrão do §7 em vez de derrubar a tela — uma página que mostra o
 * formulário padrão ainda coleta inscrição; uma página que não abre, não.
 */
export function readLandingFields(value: unknown): LandingFieldKey[] {
  if (!Array.isArray(value)) return [...LANDING_FIELD_KEYS];

  const conhecidos = value.filter((campo): campo is LandingFieldKey =>
    (LANDING_FIELD_KEYS as readonly string[]).includes(campo as string),
  );

  const semRepetidos = [...new Set(conhecidos)];
  return validateLandingFields(semRepetidos) === null ? semRepetidos : [...LANDING_FIELD_KEYS];
}

/* -------------------------------------------------------------------------- */
/* Mensagem de sucesso (§18)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * As variáveis que a mensagem de confirmação aceita (§18).
 *
 * ⚠️ A LISTA É FECHADA, E É ISSO QUE O §18 PEDE ("Não permitir variáveis
 * arbitrárias"). Um `{{qualquer_coisa}}` que não esteja aqui fica LITERAL no
 * texto — não vira string vazia. A diferença importa: um marcador que some sem
 * deixar rastro faz a frase ficar truncada e ninguém descobre por quê; um
 * marcador que aparece cru na prévia é visível no segundo em que se digita.
 */
export const LANDING_TEMPLATE_VARIABLES = [
  "event_name",
  "event_date",
  "event_start_time",
  "event_end_time",
] as const;

export type LandingTemplateVariable = (typeof LANDING_TEMPLATE_VARIABLES)[number];

/** Os dados do evento de que a substituição precisa. */
export interface LandingTemplateEvent {
  name: string;
  /** AAAA-MM-DD. */
  eventDate: string;
  /** "HH:MM". */
  startTime: string;
  endTime: string | null;
}

/**
 * Troca os marcadores pelos dados reais do evento.
 *
 * ⚠️ DUAS SINTAXES, E A ANTIGA NÃO PODE MORRER. O Prompt 1 semeou `<EVENTO>` e
 * `<DATA>`; o §18 do Prompt 2 pede `{{event_name}}` e companhia. A migration
 * 20260923000000 trocou o texto SEMEADO, mas qualquer Landing Page que já
 * tenha gravado `<EVENTO>` no override dela continuaria mostrando o marcador
 * cru se esta função só entendesse a forma nova.
 *
 * A nova é a que se oferece daqui para a frente; a antiga é reconhecida para
 * não quebrar o que já existe.
 */
export function applyTemplateVariables(texto: string, event: LandingTemplateEvent): string {
  const valores: Record<LandingTemplateVariable, string> = {
    event_name: event.name,
    event_date: formatEventDate(event.eventDate),
    event_start_time: event.startTime,
    event_end_time: event.endTime ?? "",
  };

  return (
    texto
      // `{{ nome }}` com espaços também casa: quem digita à mão põe espaço, e
      // recusar por causa disso seria pedantismo com custo real.
      .replace(/\{\{\s*(\w+)\s*\}\}/g, (cru, nome: string) =>
        nome in valores ? valores[nome as LandingTemplateVariable] : cru,
      )
      // A sintaxe do Prompt 1, mantida viva. Ver o aviso acima.
      .replaceAll("<EVENTO>", valores.event_name)
      .replaceAll("<DATA>", valores.event_date)
  );
}

/**
 * O texto de confirmação, resolvido.
 *
 * ⚠️ DUAS FONTES, NUNCA DUAS VERDADES. A Landing Page pode sobrescrever cada um
 * dos três pedaços; o que ela não define vem do texto padrão da plataforma
 * (`app_settings`, editável em /settings/texts). O padrão só é consultado
 * quando a específica não existe — e é por isso que não há hardcode em service
 * nem em controller, como o §18 exige.
 *
 * A substituição acontece aqui, e não concatenada no SQL, porque quem edita o
 * texto precisa poder mover o nome do evento de lugar na frase.
 */
export function resolveSuccessMessage(
  page: {
    successTitle: string | null;
    successMessage: string | null;
    successFooter: string | null;
  },
  defaults: LandingSuccessMessage,
  event: LandingTemplateEvent,
): LandingSuccessMessage {
  return {
    title: applyTemplateVariables(page.successTitle ?? defaults.title, event),
    message: applyTemplateVariables(page.successMessage ?? defaults.message, event),
    footer: applyTemplateVariables(page.successFooter ?? defaults.footer, event),
  };
}

/** AAAA-MM-DD → DD/MM/AAAA, sem passar por `Date` (que traria fuso junto). */
function formatEventDate(isoDate: string): string {
  const [ano, mes, dia] = isoDate.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : isoDate;
}

/* -------------------------------------------------------------------------- */
/* Ordenação e filtros (§23)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Ordem da grid de Landing Pages: a dos EVENTOS, os próximos primeiro.
 *
 * A mesma de `compareEvents`, e pelo mesmo motivo: ordenar tudo em ordem
 * crescente pura colocaria o evento de 2024 no topo, que é o oposto do que a
 * pessoa quer ver ao abrir a tela.
 */
export function compareLandingPages(
  a: LandingPageWithEvent,
  b: LandingPageWithEvent,
  today: string,
): number {
  const aPast = a.event.eventDate < today;
  const bPast = b.event.eventDate < today;
  if (aPast !== bPast) return aPast ? 1 : -1;

  if (a.event.eventDate !== b.event.eventDate) {
    return aPast
      ? b.event.eventDate.localeCompare(a.event.eventDate)
      : a.event.eventDate.localeCompare(b.event.eventDate);
  }

  return a.event.name.localeCompare(b.event.name, "pt-BR");
}

/**
 * Nome do evento + situação + período. Vazio em todos = passa tudo.
 *
 * ⚠️ O FILTRO DE SITUAÇÃO TRABALHA SOBRE A SITUAÇÃO EFETIVA. Quem escolhe
 * "Encerrada" quer ver tanto as que alguém encerrou quanto as que venceram o
 * prazo ou lotaram — para quem olha a tela, as três são "não aceita mais
 * inscrição".
 */
export function matchesLandingFilters(
  page: LandingPageWithEvent,
  filters: LandingPageFilters,
  now: Date = new Date(),
): boolean {
  if (filters.status !== "all" && landingEffectiveStatus(page, now) !== filters.status) {
    return false;
  }

  // Inclusivo nas duas pontas: quem digita 01/08 a 31/08 espera ver o evento do
  // dia 31.
  if (filters.from && page.event.eventDate < filters.from) return false;
  if (filters.to && page.event.eventDate > filters.to) return false;

  const busca = normalizeForSearch(filters.query);
  if (!busca) return true;

  // ⚠️ O SLUG TAMBÉM (§4). Quem chega com o endereço na mão — colado de uma
  // conversa de WhatsApp, de um relatório — procura por ele, não pelo nome do
  // evento. Sem isto, colar `encontro-tecnico` na busca devolveria "nenhuma
  // página encontrada" sobre a página que a pessoa está olhando.
  return (
    normalizeForSearch(page.event.name).includes(busca) ||
    normalizeForSearch(page.slug).includes(busca)
  );
}

/**
 * A inscrição casa com os filtros da tela?
 *
 * ⚠️ A BUSCA OLHA TRÊS CAMPOS, e o de participante é o que faz a tela servir: a
 * pergunta real de quem abre é "o fulano está inscrito?", e o nome dele não
 * está na linha da inscrição, está numa das pessoas dela.
 *
 * O filtro de confirmação também olha os participantes: uma inscrição APARECE
 * se ao menos uma pessoa dela está no estado procurado. Exigir que todas
 * estivessem esconderia exatamente a granja de quatro funcionários em que só um
 * não confirmou — que é a que precisa de telefonema.
 */
export function matchesRegistrationFilters(
  registration: RegistrationRow,
  filters: RegistrationFilters,
): boolean {
  if (filters.status !== "all" && registration.status !== filters.status) return false;

  if (filters.confirmation !== "all") {
    const alguem = registration.participants.some(
      (pessoa) => pessoa.confirmation === filters.confirmation,
    );
    if (!alguem) return false;
  }

  const busca = normalizeForSearch(filters.query);
  if (!busca) return true;

  if (normalizeForSearch(registration.companyName).includes(busca)) return true;

  return registration.participants.some(
    (pessoa) =>
      normalizeForSearch(pessoa.fullName).includes(busca) ||
      normalizeForSearch(pessoa.email).includes(busca),
  );
}

/** Quantas pessoas esta inscrição tem em cada estado de confirmação. */
export function countByConfirmation(
  registrations: readonly RegistrationRow[],
): Record<ConfirmationFilter, number> {
  const ativas = registrations.filter((r) => r.status === "active");
  const pessoas = ativas.flatMap((r) => r.participants);

  return {
    all: pessoas.length,
    confirmed: pessoas.filter((p) => p.confirmation === "confirmed").length,
    not_confirmed: pessoas.filter((p) => p.confirmation === "not_confirmed").length,
  };
}
