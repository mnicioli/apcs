import { z } from "zod";
import { onlyDigits } from "@/lib/format/phone";
import {
  LANDING_FIELD_KEYS,
  LANDING_PAGE_STATUSES,
  MAX_PARTICIPANTS_PER_REGISTRATION,
  PARTICIPANT_CONFIRMATIONS,
} from "./event.landing.types";
import { isValidSlug, validateLandingFields } from "./event.landing.rules";

/**
 * Contratos de entrada de Landing Pages e Inscrições. Os mesmos schemas rodam
 * no cliente (React Hook Form) e dentro das actions — defesa em profundidade.
 *
 * ⚠️ E NENHUM DELES É A ÚLTIMA BARREIRA. O §17 é explícito: "Não confiar somente
 * nas validações do frontend." Cada regra abaixo tem uma gêmea no Postgres (um
 * CHECK, um índice único ou uma cláusula de `create_event_registration`), e é a
 * gêmea que garante. O Zod está aqui para DIZER O QUE ESTÁ ERRADO em português,
 * campo a campo — coisa que uma violação de constraint não sabe fazer.
 *
 * ⚠️ A INSCRIÇÃO PÚBLICA AINDA NÃO TEM TELA (Prompt 3), e o schema dela já
 * existe. Não é adiantar trabalho: é a action de criação do backoffice
 * (Prompt 2) que precisa dele agora, e as duas portas têm de validar a mesma
 * coisa. Escrever dois schemas parecidos, um por porta, é como elas passariam a
 * aceitar entradas diferentes.
 */

/* -------------------------------------------------------------------------- */
/* Peças reutilizadas                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Só dígitos: a máscara é da tela, o que se guarda é o número.
 *
 * ⚠️ ERA UMA CÓPIA. Este arquivo tinha a sua própria `onlyDigits` (`/\D/g`) e
 * `membership.schema.ts` tinha a dele (`/\D+/g`) — mesmo resultado, nenhuma
 * ligação entre as duas. Agora as duas apontam para `@/lib/format/phone`, que é
 * também de onde sai a máscara do formulário público de inscrição.
 */
export { onlyDigits };

const phoneSchema = z
  .string()
  .trim()
  .transform(onlyDigits)
  .refine(
    (digitos) => digitos === "" || (digitos.length >= 10 && digitos.length <= 15),
    "Informe um número com DDD.",
  );

/**
 * E-mail, sempre em minúsculas.
 *
 * ⚠️ O `toLowerCase` NÃO É COSMÉTICO: é dele que depende o índice único do §12.
 * "Joao@x.com" e "joao@x.com" são a mesma pessoa, e um índice sobre o valor cru
 * deixaria as duas entrarem no mesmo evento. O CHECK
 * `event_participants_email_lower` fecha a mesma porta no banco.
 */
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, "Informe o e-mail.")
  .max(254, "E-mail muito longo.")
  .email("E-mail inválido.");

/* -------------------------------------------------------------------------- */
/* Landing Page                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A lista de campos do formulário.
 *
 * O `superRefine` traduz o problema devolvido por `validateLandingFields` — a
 * MESMA função que o Builder do Prompt 2 chama enquanto a pessoa arrasta. Uma
 * segunda lista de regras aqui seria a forma de o botão "Salvar" recusar algo
 * que o canvas mostrava como válido.
 */
export const landingFieldsSchema = z
  .array(z.enum(LANDING_FIELD_KEYS))
  .superRefine((campos, ctx) => {
    const problema = validateLandingFields(campos);
    if (!problema) return;

    const mensagens: Record<NonNullable<typeof problema>, string> = {
      empty: "Escolha ao menos um campo para o formulário.",
      unknownField: "Há um campo desconhecido na configuração do formulário.",
      duplicateField: "Há um campo repetido na configuração do formulário.",
      missingRequired:
        "Granja/Empresa, E-mail e Nome do Participante são obrigatórios no formulário.",
      missingContact:
        "Inclua Telefone ou WhatsApp: cada participante precisa informar um dos dois.",
    };

    ctx.addIssue({ code: z.ZodIssueCode.custom, message: mensagens[problema] });
  });

/**
 * O slug digitado à mão. VAZIO É PERMITIDO e significa "gera a partir do nome
 * do evento" (§6) — ou, na edição, "mantém o atual".
 */
const slugFieldSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (valor) => valor === "" || isValidSlug(valor),
    "Use apenas letras minúsculas, números e hífen (3 a 120 caracteres).",
  );

/**
 * ISO 8601 com fuso, que é o que `<input type="datetime-local">` produz depois
 * de o cliente carimbar o fuso. Vazio = sem prazo (§16).
 */
const closesAtSchema = z
  .string()
  .trim()
  .refine((valor) => valor === "" || !Number.isNaN(Date.parse(valor)), "Data e hora inválidas.");

/**
 * A capacidade chega como TEXTO (é um `<input>`), e o banco guarda inteiro.
 * Vazio = sem limite.
 *
 * ⚠️ ZERO É RECUSADO, e o CHECK `event_landing_pages_capacity` recusa igual.
 * Uma página publicada com capacidade zero seria uma página que recusa todo
 * mundo sem dizer por quê — quem quer isso encerra a página, que é a operação
 * que descreve o que está acontecendo.
 */
const maxParticipantsSchema = z
  .string()
  .trim()
  .refine(
    (valor) => valor === "" || (/^\d{1,6}$/.test(valor) && Number(valor) > 0),
    "Informe um número maior que zero, ou deixe em branco para não limitar.",
  );

/**
 * O formulário da Landing Page, como a tela do Builder o envia.
 *
 * ============================================================================
 * ⚠️ NÃO HÁ MAIS TEXTO NENHUM AQUI, E ISSO FOI UMA DECISÃO DO CLIENTE.
 * ============================================================================
 * `description`, `successTitle`, `successMessage` e `successFooter` saíram
 * juntas: a página pública deixou de ter texto solto — a arte diz o que precisa
 * dizer, e a confirmação virou um BANNER (`success_image_path`), que sobe pelo
 * caminho de imagem e não por este schema.
 *
 * O que sobrou é o que não é texto de página: o endereço, a ordem dos campos, o
 * prazo e a capacidade.
 *
 * ⚠️ E A PORTA DO BANCO FECHOU JUNTO. Tirar os campos daqui sozinho seria uma
 * decisão de tela: `update_event_landing_page` perdeu os quatro parâmetros e o
 * `grant update` das quatro colunas foi revogado, então não há caminho por onde
 * um texto novo entre — nem pelo PostgREST. Ver a decisão 1 de
 * 20260928000000_event_landing_success_image.sql.
 */
export const landingPageFormSchema = z.object({
  slug: slugFieldSchema,
  formFields: landingFieldsSchema,
  closesAt: closesAtSchema.optional().or(z.literal("")),
  maxParticipants: maxParticipantsSchema.optional().or(z.literal("")),
});

export type LandingPageFormData = z.infer<typeof landingPageFormSchema>;

export const createLandingPageSchema = landingPageFormSchema.extend({
  eventId: z.string().uuid(),
});

export type CreateLandingPageInput = z.infer<typeof createLandingPageSchema>;

export const updateLandingPageSchema = landingPageFormSchema.extend({
  landingPageId: z.string().uuid(),
});

export type UpdateLandingPageInput = z.infer<typeof updateLandingPageSchema>;

/**
 * Publicar, encerrar ou tirar do ar.
 *
 * `command` e não `status`: quem clica escolhe uma AÇÃO, e a situação resultante
 * é consequência dela. Mesma forma de `eventCommandSchema`.
 */
export const landingCommandSchema = z.object({
  landingPageId: z.string().uuid(),
  command: z.enum(["publish", "close", "deactivate"]),
});

export type LandingCommandInput = z.infer<typeof landingCommandSchema>;

/** Só para conferir que uma situação lida da URL ou do banco é conhecida. */
export const landingStatusSchema = z.enum(LANDING_PAGE_STATUSES);

/* -------------------------------------------------------------------------- */
/* Inscrição                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Um participante.
 *
 * ⚠️ O `refine` DE TELEFONE-OU-WHATSAPP É O §8, e ele está no nível do OBJETO
 * porque precisa dos dois valores. Os gêmeos no banco são o CHECK
 * `event_participants_needs_a_phone` (que impede a linha de existir sem
 * nenhum dos dois) e a etapa 5 de `create_event_registration` (que dá a
 * mensagem certa antes de chegar lá).
 */
export const participantSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Informe o nome do participante.")
      .max(160, "Nome muito longo."),
    email: emailSchema,
    phone: phoneSchema.optional().or(z.literal("")),
    whatsapp: phoneSchema.optional().or(z.literal("")),
  })
  .refine((pessoa) => Boolean(pessoa.phone) || Boolean(pessoa.whatsapp), {
    message: "Informe telefone ou WhatsApp.",
    // O erro fica no campo de telefone, e não solto no objeto: sem `path`, a
    // tela teria de inventar onde mostrá-lo, e é no primeiro dos dois campos
    // vazios que a pessoa está olhando.
    path: ["phone"],
  });

export type ParticipantInput = z.infer<typeof participantSchema>;

/**
 * A inscrição inteira.
 *
 * ⚠️ O `superRefine` DE E-MAIL REPETIDO É A METADE INTERNA DO §12 — "João /
 * joao@email.com" e "Maria / joao@email.com" na mesma requisição. A outra
 * metade (contra as inscrições que JÁ existem no evento) não pode ser feita
 * aqui: ela precisa do banco, e está na etapa 7 de `create_event_registration`,
 * com o índice único como garantia final.
 *
 * O erro é apontado para a LINHA REPETIDA, e não para a primeira: quem digitou
 * a segunda é quem precisa corrigi-la.
 */
const registrationBaseSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(2, "Informe a granja ou empresa.")
    .max(200, "Nome muito longo."),
  participants: z
    .array(participantSchema)
    .min(1, "Inclua ao menos um participante.")
    // Um teto por inscrição, para uma requisição não chegar com dez mil
    // pessoas. Não é regra de negócio — é limite de tamanho de payload (§28),
    // e é generoso o bastante para a maior granja da base. A constante mora em
    //  porque a tela pública também precisa dela, para
    // parar de oferecer o botão de acrescentar (§13 do Prompt 3).
    .max(
      MAX_PARTICIPANTS_PER_REGISTRATION,
      `O limite de ${MAX_PARTICIPANTS_PER_REGISTRATION} participantes por inscrição foi atingido.`,
    ),
});

/**
 * ⚠️ FUNÇÃO SOLTA, E NÃO UM `.superRefine` ENCADEADO NO OBJETO BASE. No Zod 3,
 * `superRefine` devolve um `ZodEffects`, que não tem `.extend()` — o schema da
 * action precisa acrescentar `landingPageId`, e encadeando primeiro não haveria
 * como. Extraindo a regra, as duas formas do schema aplicam a MESMA verificação
 * em vez de cada uma repetir a sua.
 */
function refuseRepeatedEmail(
  dados: { participants: { email: string }[] },
  ctx: z.RefinementCtx,
): void {
  const vistos = new Set<string>();

  dados.participants.forEach((pessoa, indice) => {
    const email = pessoa.email.trim().toLowerCase();
    if (vistos.has(email)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Este e-mail já foi informado nesta inscrição.",
        path: ["participants", indice, "email"],
      });
      return;
    }
    vistos.add(email);
  });
}

export const registrationFormSchema = registrationBaseSchema.superRefine(refuseRepeatedEmail);

export type RegistrationFormData = z.infer<typeof registrationFormSchema>;

/**
 * O que a action de criação recebe.
 *
 * ⚠️ `dedupeKey` NÃO ESTÁ AQUI, e é deliberado. A chave de idempotência é
 * montada no SERVIDOR, a partir do e-mail do primeiro participante e de uma
 * janela de tempo — do mesmo jeito que `buildDedupeKey` faz em Associados.
 * Aceitá-la do cliente deixaria qualquer um mandar a chave de OUTRA inscrição e
 * receber os dados dela de volta como se fosse "duplicada".
 */
export const createRegistrationSchema = registrationBaseSchema
  .extend({ landingPageId: z.string().uuid() })
  .superRefine(refuseRepeatedEmail);

export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;

/**
 * Edição do backoffice: nome da granja e/ou situação.
 *
 * ⚠️ `eventId` ENTROU NO PROMPT 4, E NÃO É REDUNDANTE. O §26 pede a cadeia
 * conferida no backend — Evento → Landing Page → Inscrição → Participante — e a
 * função Postgres recusa quando a inscrição pertence a outro evento. Sem o
 * campo, a action não teria o que mandar, e a proteção contra IDOR dependeria de
 * ninguém trocar o id na requisição.
 */
export const updateRegistrationSchema = z.object({
  eventId: z.string().uuid(),
  registrationId: z.string().uuid(),
  companyName: z
    .string()
    .trim()
    .min(2, "Informe a granja ou empresa.")
    .max(200, "Nome muito longo.")
    .optional(),
  status: z.enum(["active", "cancelled"]).optional(),
});

export type UpdateRegistrationInput = z.infer<typeof updateRegistrationSchema>;

export const participantConfirmationSchema = z.object({
  /** Ver o aviso de `updateRegistrationSchema`: é o §26 (IDOR). */
  eventId: z.string().uuid(),
  participantId: z.string().uuid(),
  confirmation: z.enum(["confirmed", "not_confirmed"]),
});

export type ParticipantConfirmationInput = z.infer<typeof participantConfirmationSchema>;

/* -------------------------------------------------------------------------- */
/* Imagem da página (§8 do Prompt 2)                                          */
/* -------------------------------------------------------------------------- */

/**
 * QUAL DAS DUAS ARTES. A página de inscrição tem duas: o banner que abre a
 * página e o banner que a substitui depois da inscrição.
 *
 * ⚠️ UM DISCRIMINADOR, E NÃO DUAS FAMÍLIAS DE ACTION. As duas artes passam pelo
 * mesmo bucket, o mesmo teto de 5 MB, a mesma inspeção de bytes no servidor e o
 * mesmo descarte do arquivo substituído. O que difere é a PASTA no Storage e a
 * função Postgres que grava a linha — dois `switch` de uma linha cada. Duplicar
 * as três actions para trocar isso é como uma das cópias deixa de receber a
 * próxima correção de segurança.
 *
 * ⚠️ E ELE É VALIDADO, não interpretado. `slot` chega do navegador: um valor
 * fora deste enum não escolhe pasta nenhuma — o schema recusa antes.
 */
export const LANDING_IMAGE_SLOTS = ["page", "success"] as const;
export type LandingImageSlot = (typeof LANDING_IMAGE_SLOTS)[number];

const landingImageSlotSchema = z.enum(LANDING_IMAGE_SLOTS);

/** Remover uma das duas artes: a página e qual delas, e nada mais. */
export const landingImageRemovalSchema = z.object({
  landingPageId: z.string().uuid(),
  slot: landingImageSlotSchema,
});

export type LandingImageRemovalInput = z.infer<typeof landingImageRemovalSchema>;

/**
 * O pedido de endereço para enviar a arte.
 *
 * ⚠️ NÃO RECEBE `eventId`. O caminho no bucket é `<event_id>/landing/<uuid>`, e
 * a action descobre o evento LENDO a página. Aceitar o id de fora deixaria
 * alguém escrever na pasta de outro evento — é o mesmo cuidado que faz o
 * `storagePath` ser conferido contra o prefixo no passo seguinte.
 */
export const landingImageTicketSchema = z.object({
  landingPageId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  slot: landingImageSlotSchema,
});

export type LandingImageTicketInput = z.infer<typeof landingImageTicketSchema>;

export const landingImageSchema = z.object({
  landingPageId: z.string().uuid(),
  storagePath: z.string().trim().min(1).max(400),
  slot: landingImageSlotSchema,
});

export type LandingImageInput = z.infer<typeof landingImageSchema>;

/* -------------------------------------------------------------------------- */
/* A inscrição PÚBLICA (§15, §21, §35 do Prompt 3)                            */
/* -------------------------------------------------------------------------- */

/**
 * O que a página `/eventos/[slug]` envia.
 *
 * ============================================================================
 * ⚠️ ELE MANDA O SLUG, E NÃO O `landingPageId`. É A DIFERENÇA QUE IMPORTA.
 * ============================================================================
 * O §21 desenha o payload com `landingPageId`, e a action do backoffice o
 * recebe assim — lá quem chama é uma tela que já leu a página e tem o id na
 * mão. Aqui é o contrário: o navegador nunca RECEBE o id. Ele conhece o
 * endereço, que está na barra do navegador, e o servidor deriva o resto.
 *
 * Isso não é um capricho de simetria. O próprio §21 dá a regra — "não confiar
 * no eventId enviado pelo cliente se a Landing Page já permite determinar o
 * evento" — e ela vale um degrau acima: se o cliente não precisa escolher a
 * página, ele não deve poder escolher a página. Com o id no corpo, um POST
 * forjado poderia apontar para a página de OUTRO evento; com o slug, o alvo é a
 * mesma coisa que o endereço aberto, e `get_public_event_landing_page` já
 * recusa rascunho e inativa.
 *
 * O resto — granja e participantes — é `registrationBaseSchema`, o MESMO do
 * backoffice. As duas portas validam a mesma coisa porque compartilham a peça,
 * e não porque alguém lembrou de copiar a regra.
 */
export const publicRegistrationSchema = registrationBaseSchema
  .extend({
    slug: z.string().trim().toLowerCase().refine(isValidSlug, "Endereço de página inválido."),

    /**
     * A versão do texto de consentimento que estava NA TELA (§35).
     *
     * ⚠️ VIAJA COM O ENVIO, e não é relida no servidor. Se alguém publicar um
     * texto novo enquanto a granja preenche o formulário, a inscrição tem de
     * guardar a versão que ESSA PESSOA leu — buscar a vigente no momento da
     * gravação registraria uma autorização para um texto que ela nunca viu. É
     * a mesma decisão de `submitMembershipApplicationAction`.
     */
    consentVersion: z
      .string()
      .trim()
      .regex(/^[0-9a-zA-Z._-]{3,40}$/, "Versão de consentimento inválida."),

    /**
     * O aceite. Recusar aqui e no banco (RG008) é defesa em profundidade: esta
     * dá a mensagem no campo certo, aquela garante que nenhum caminho grava
     * inscrição pública sem autorização registrada.
     */
    consentAccepted: z
      .boolean()
      .refine((aceito) => aceito, "É preciso aceitar o tratamento dos dados para se inscrever."),
  })
  .superRefine(refuseRepeatedEmail);

export type PublicRegistrationInput = z.infer<typeof publicRegistrationSchema>;

/** Um participante em branco — o que o botão "Adicionar participante" cria. */
export function emptyParticipant(): ParticipantInput {
  return { fullName: "", email: "", phone: "", whatsapp: "" };
}

/* -------------------------------------------------------------------------- */
/* Edição de participante — §13, §14, §15 do Prompt 4                         */
/* -------------------------------------------------------------------------- */

/**
 * A ficha de um participante, como o backoffice a envia.
 *
 * ============================================================================
 * ⚠️ ELE ESTENDE `participantSchema`, E NÃO REESCREVE AS REGRAS.
 * ============================================================================
 * O §13 é explícito: "utilizar as mesmas regras e validações do cadastro
 * público". `participantSchema` já é a peça que o formulário público usa — com
 * o e-mail em minúsculas, os telefones só com dígitos e o `refine` de
 * "telefone OU WhatsApp" (§15). Escrever um schema parecido aqui é como as duas
 * portas passariam a aceitar coisas diferentes da mesma pessoa.
 *
 * O que se acrescenta é o que só existe aqui: os dois identificadores da cadeia
 * (§26) e a confirmação, que a ficha pode mudar junto com o resto (§13).
 *
 * ⚠️ O `.refine` DE `participantSchema` NÃO SOBREVIVE A UM `.extend()` — no
 * Zod 3, `refine` devolve `ZodEffects`, que não tem `.extend`. É a mesma
 * armadilha de `refuseRepeatedEmail`, e a saída é a mesma: montar o objeto e
 * reaplicar a regra. `PHONE_OR_WHATSAPP` existe para ela ser escrita uma vez.
 */
// Sem `as const`: ele deixaria `path` readonly, e o Zod 3 pede um array mutável.
const PHONE_OR_WHATSAPP = {
  message: "Informe telefone ou WhatsApp.",
  path: ["phone"],
};

export const updateParticipantSchema = z
  .object({
    eventId: z.string().uuid(),
    participantId: z.string().uuid(),
    fullName: z
      .string()
      .trim()
      .min(2, "Informe o nome do participante.")
      .max(160, "Nome muito longo."),
    email: emailSchema,
    phone: phoneSchema.optional().or(z.literal("")),
    whatsapp: phoneSchema.optional().or(z.literal("")),
    confirmation: z.enum(PARTICIPANT_CONFIRMATIONS),
  })
  .refine((pessoa) => Boolean(pessoa.phone) || Boolean(pessoa.whatsapp), PHONE_OR_WHATSAPP);

export type UpdateParticipantInput = z.infer<typeof updateParticipantSchema>;

/**
 * A edição da granja, na ficha da inscrição (§13).
 *
 * Separada da edição do participante porque são objetos diferentes: a granja é
 * da INSCRIÇÃO e vale para todo mundo dela; o resto é da PESSOA. Um formulário
 * só, com os dois, faria parecer que mudar a granja de João mudaria só a de
 * João — quando ela é a mesma da Maria e do Pedro na mesma inscrição.
 */
export const updateCompanySchema = z.object({
  eventId: z.string().uuid(),
  registrationId: z.string().uuid(),
  companyName: z
    .string()
    .trim()
    .min(2, "Informe a granja ou empresa.")
    .max(200, "Nome muito longo."),
});

export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
