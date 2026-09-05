import { z } from "zod";
import { LANDING_FIELD_KEYS, LANDING_PAGE_STATUSES } from "./event.landing.types";
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
 * Só dígitos, entre 10 e 15.
 *
 * O mesmo tratamento de `members.whatsapp`: a máscara é da tela, o que se
 * guarda é o número. 10 cobre o fixo com DDD; 15 é o teto do E.164, para não
 * recusar um número internacional legítimo.
 */
export function onlyDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

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

/** O formulário da Landing Page, como a tela do Builder o envia. */
export const landingPageFormSchema = z.object({
  slug: slugFieldSchema,
  description: z
    .string()
    .trim()
    .max(4000, "Descrição muito longa (máximo de 4000 caracteres).")
    .optional()
    .or(z.literal("")),
  formFields: landingFieldsSchema,
  /**
   * Os três pedaços da mensagem de confirmação. VAZIO SIGNIFICA "usa o texto
   * padrão da plataforma" (§18) — e é por isso que não há mínimo aqui: exigir
   * dois caracteres impediria de LIMPAR o campo para voltar ao padrão.
   */
  successTitle: z.string().trim().max(160, "Título muito longo.").optional().or(z.literal("")),
  successMessage: z.string().trim().max(1000, "Mensagem muito longa.").optional().or(z.literal("")),
  successFooter: z
    .string()
    .trim()
    .max(300, "Texto final muito longo.")
    .optional()
    .or(z.literal("")),
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
    // e é generoso o bastante para a maior granja da base.
    .max(200, "Máximo de 200 participantes por inscrição."),
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

/** Edição do backoffice: nome da granja e/ou situação. */
export const updateRegistrationSchema = z.object({
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
  participantId: z.string().uuid(),
  confirmation: z.enum(["confirmed", "not_confirmed"]),
});

export type ParticipantConfirmationInput = z.infer<typeof participantConfirmationSchema>;

/* -------------------------------------------------------------------------- */
/* Imagem da página (§8 do Prompt 2)                                          */
/* -------------------------------------------------------------------------- */

/** O identificador sozinho, para as operações que não recebem mais nada. */
export const landingPageIdSchema = z.object({
  landingPageId: z.string().uuid(),
});

export type LandingPageIdInput = z.infer<typeof landingPageIdSchema>;

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
});

export type LandingImageTicketInput = z.infer<typeof landingImageTicketSchema>;

export const landingImageSchema = z.object({
  landingPageId: z.string().uuid(),
  storagePath: z.string().trim().min(1).max(400),
});

export type LandingImageInput = z.infer<typeof landingImageSchema>;
