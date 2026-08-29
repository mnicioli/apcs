import { z } from "zod";
import { isAudienceDimensionAvailable } from "./survey.rules";
import { SURVEY_AUDIENCE_DIMENSIONS, SURVEY_SORT_FIELDS, SURVEY_STATUSES } from "./survey.types";
import { isInstantOnTimeStep, TIME_STEP_MESSAGE } from "@/lib/time/step";

/**
 * Contratos de entrada de Enquetes. Os mesmos schemas rodam no cliente (React
 * Hook Form) e dentro das actions — defesa em profundidade.
 *
 * Cada limite aqui tem um gêmeo como CHECK na tabela. O Zod existe para a pessoa
 * ver a mensagem no campo; a autoridade continua sendo o banco, que recusa igual
 * se alguém chamar o PostgREST direto (§3, §74).
 */

// ----------------------------------------------------------------------------
// Peças reaproveitadas
// ----------------------------------------------------------------------------

/**
 * Instante ISO 8601 — o que `<input type="datetime-local">` produz depois de
 * convertido, e o que o Postgres aceita em `timestamptz`.
 *
 * ⚠️ Diferente das datas de Eventos e Palestras, que são AAAA-MM-DD sem fuso.
 * Aqui o que se marca é o INSTANTE em que a urna fecha — uma fronteira absoluta
 * —, e é por isso que o tipo é outro. Ver o comentário de `starts_at` na
 * migration.
 *
 * ⚠️ `Date.parse` SOZINHO NÃO BASTA, e o motivo é traiçoeiro: ele aceita
 * "2026-02-31T10:00:00Z" sem reclamar e devolve 3 de MARÇO — o JavaScript
 * transborda o dia em vez de recusar. Um formulário que aceitasse isso gravaria
 * uma enquete fechando numa data que a pessoa não escolheu.
 *
 * (O Postgres recusaria com 22008, então o dado nunca chegaria errado ao banco.
 * Mas o erro apareceria como "dados inválidos" genérico depois de submeter, em
 * vez de no campo, na hora.)
 *
 * A checagem: reconstruir a parte da DATA a partir do que foi interpretado. Se
 * ela não voltar igual, o dia transbordou.
 */
const instantSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Informe uma data e um horário válidos.")
  .refine((value) => {
    const parteData = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parteData)) return true; // outro formato: o parse acima já decidiu
    const reconstruida = new Date(`${parteData}T00:00:00Z`);
    return (
      !Number.isNaN(reconstruida.getTime()) && reconstruida.toISOString().startsWith(parteData)
    );
  }, "Data inválida.");

/**
 * O instante de um AGENDAMENTO — o mesmo de cima, preso à grade de 5 minutos.
 *
 * ⚠️ É UM SCHEMA SEPARADO, E ISSO NÃO É ZELO: `instantSchema` também valida o
 * `from`/`to` do filtro da lista, e ali o "até" é montado como
 * `AAAA-MM-DDT23:59:59.999Z` — o dia inteiro, como quem filtra "até 20/08"
 * espera. O minuto 59 não está na grade de 5. Se a regra do passo entrasse no
 * `instantSchema`, o filtro da lista de enquetes pararia de funcionar por causa
 * de uma política que só diz respeito a quem MARCA horário.
 *
 * ⚠️ Os minutos são lidos em UTC (ver `isInstantOnTimeStep`), porque o que
 * chega aqui já passou por `fromLocalInput` no formulário e virou instante
 * absoluto.
 */
const scheduledInstantSchema = instantSchema.refine(isInstantOnTimeStep, {
  message: TIME_STEP_MESSAGE,
});

/** Aceita string vazia como "não informado", em vez de exigir `undefined`. */
function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, z.literal("")]).optional();
}

/**
 * O mesmo, aceitando também `null`.
 *
 * ⚠️ Existe por causa de um defeito real, encontrado no navegador: os tipos do
 * domínio (`SurveyAudienceCriterion`) usam `string | null` para os campos não
 * preenchidos — é o que vem do banco —, mas o `optional()` acima só aceita
 * `string | "" | undefined`. Um critério de região montado pela tela chegava com
 * `segmentId: null`, o parse falhava, e a estimativa devolvia **0 pessoas com
 * toda a confiança**, indistinguível de um público realmente vazio.
 *
 * Obrigar cada chamador a converter `null` em `""` foi exatamente o que produziu
 * o defeito. O schema aceitar as duas formas de "vazio" é o que impede a
 * próxima ocorrência.
 */
function optionalNullable<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, z.literal(""), z.null()]).optional();
}

/** Converte "" em `null` — o que o banco entende por "não informado". */
export function emptyToNull(value: string | null | undefined): string | null {
  const limpo = value?.trim();
  return limpo ? limpo : null;
}

/** UF de duas letras (§27) — a chave da dimensão `region`. */
const ufSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "Informe a UF com duas letras (ex.: SP).")
  .transform((v) => v.toUpperCase());

const uuidSchema = z.string().uuid("Identificador inválido.");

// ----------------------------------------------------------------------------
// As alternativas (§7)
// ----------------------------------------------------------------------------

/**
 * A lista de alternativas, na ordem em que devem aparecer.
 *
 * ⚠️ Duas é o mínimo, e não uma: uma "escolha única" com uma opção só é um
 * aviso, não uma enquete. O mesmo piso está em `create_survey` no banco.
 *
 * O limite de 10 vem do §41: acima disso a mensagem do WhatsApp deixa de caber
 * numa tela de celular e os emojis de número acabam. Não é um CHECK no banco de
 * propósito — é uma regra de APRESENTAÇÃO, e o dia em que a APCS quiser 12
 * opções num canal que as comporte, o banco não deve ser o obstáculo.
 */
export const surveyOptionsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, "A alternativa não pode ficar em branco.")
      .max(200, "Alternativa muito longa (máximo de 200 caracteres)."),
  )
  .min(2, "Informe ao menos duas alternativas.")
  .max(10, "No máximo 10 alternativas — é o que cabe numa mensagem de WhatsApp.")
  .refine(
    (opcoes) => new Set(opcoes.map((o) => o.toLowerCase())).size === opcoes.length,
    "Há alternativas repetidas.",
  );

// ----------------------------------------------------------------------------
// O núcleo do formulário (§4, §6, §7, §17)
// ----------------------------------------------------------------------------

export const surveyCoreSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, "Informe o título da enquete.")
      .max(200, "Título muito longo (máximo de 200 caracteres)."),
    description: optional(
      z.string().trim().max(2000, "Descrição muito longa (máximo de 2000 caracteres)."),
    ),
    question: z
      .string()
      .trim()
      .min(3, "Informe a pergunta da enquete.")
      .max(500, "Pergunta muito longa (máximo de 500 caracteres)."),
    options: surveyOptionsSchema,

    startsAt: optional(scheduledInstantSchema),
    endsAt: optional(scheduledInstantSchema),
    scheduledAt: optional(scheduledInstantSchema),

    isAnonymous: z.boolean().default(false),
    allowsResponseChange: z.boolean().default(false),
  })
  // §17. Validado no nível do OBJETO porque precisa dos dois valores. O gêmeo é
  // o CHECK `surveys_window_order`, e lá — como aqui — o fim é ESTRITAMENTE
  // maior que o início: o escopo recusa igual e recusa menor, em duas frases
  // separadas, justamente porque `>=` é o erro fácil de cometer.
  .refine(
    (dados) =>
      !dados.startsAt || !dados.endsAt || Date.parse(dados.endsAt) > Date.parse(dados.startsAt),
    {
      message: "A data de encerramento deve ser posterior à data de início.",
      path: ["endsAt"],
    },
  )
  // §35. Enviar antes de abrir a urna faria a pessoa receber o convite e levar
  // "esta enquete não está disponível".
  .refine(
    (dados) =>
      !dados.startsAt ||
      !dados.scheduledAt ||
      Date.parse(dados.scheduledAt) >= Date.parse(dados.startsAt),
    {
      message: "O envio não pode ser anterior ao início da enquete.",
      path: ["scheduledAt"],
    },
  );

export type SurveyFormInput = z.input<typeof surveyCoreSchema>;
export type SurveyFormValues = z.output<typeof surveyCoreSchema>;

/** A edição descritiva (§60) — sem pergunta e sem alternativas, que têm caminho próprio. */
export const surveyDetailsSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, "Informe o título da enquete.")
      .max(200, "Título muito longo (máximo de 200 caracteres)."),
    description: optional(
      z.string().trim().max(2000, "Descrição muito longa (máximo de 2000 caracteres)."),
    ),
    startsAt: optional(scheduledInstantSchema),
    endsAt: optional(scheduledInstantSchema),
    scheduledAt: optional(scheduledInstantSchema),
    isAnonymous: z.boolean().default(false),
    allowsResponseChange: z.boolean().default(false),
  })
  .refine((d) => !d.startsAt || !d.endsAt || Date.parse(d.endsAt) > Date.parse(d.startsAt), {
    message: "A data de encerramento deve ser posterior à data de início.",
    path: ["endsAt"],
  })
  .refine(
    (d) => !d.startsAt || !d.scheduledAt || Date.parse(d.scheduledAt) >= Date.parse(d.startsAt),
    { message: "O envio não pode ser anterior ao início da enquete.", path: ["scheduledAt"] },
  );

export type SurveyDetailsInput = z.input<typeof surveyDetailsSchema>;

/** A edição da pergunta e das alternativas (§60, §61). */
export const surveyQuestionSchema = z.object({
  question: z
    .string()
    .trim()
    .min(3, "Informe a pergunta da enquete.")
    .max(500, "Pergunta muito longa (máximo de 500 caracteres)."),
  options: surveyOptionsSchema,
});

export type SurveyQuestionInput = z.infer<typeof surveyQuestionSchema>;

// ----------------------------------------------------------------------------
// Segmentação (§23 a §31)
// ----------------------------------------------------------------------------

/**
 * Um critério.
 *
 * ⚠️ O `superRefine` faz DUAS coisas que valem ser lidas juntas:
 *
 *   1. Confere que o campo certo veio preenchido para a dimensão escolhida —
 *      "Região" sem dizer qual região é um filtro que não filtra. O gêmeo é o
 *      CHECK `survey_audience_shape`.
 *
 *   2. RECUSA as três dimensões sem cadastro de apoio (Segmento, Categoria,
 *      Carteira), com a mesma mensagem que o banco dá. Isso é redundante de
 *      propósito: o banco é a autoridade, mas descobrir a recusa só depois de
 *      preencher o formulário inteiro é uma péssima experiência — e a lista de
 *      dimensões disponíveis mora num lugar só, em `survey.rules.ts`.
 */
export const surveyAudienceCriterionSchema = z
  .object({
    dimension: z.enum(SURVEY_AUDIENCE_DIMENSIONS),
    segmentId: optionalNullable(uuidSchema),
    contactId: optionalNullable(uuidSchema),
    value: optionalNullable(z.string().trim().max(120)),
  })
  .superRefine((criterio, ctx) => {
    if (!isAudienceDimensionAvailable(criterio.dimension)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dimension"],
        message:
          "Esta segmentação depende do cadastro de associados, que ainda não existe no sistema. " +
          "Use Região, Perfil, contatos específicos ou Toda a base.",
      });
      return;
    }

    if (criterio.dimension === "contact" && !criterio.contactId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contactId"],
        message: "Escolha o contato.",
      });
    }

    if (criterio.dimension === "region") {
      const uf = ufSchema.safeParse(criterio.value ?? "");
      if (!uf.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: "Informe a UF com duas letras (ex.: SP).",
        });
      }
    }

    if (criterio.dimension === "profile" && !criterio.value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Escolha o perfil.",
      });
    }
  });

/**
 * O conjunto de critérios.
 *
 * Vazio é recusado: uma enquete sem público não alcança ninguém, e o §32 pede
 * que o total elegível seja calculado ANTES do envio — o que pressupõe que
 * exista o que calcular.
 */
export const surveyAudienceSchema = z
  .array(surveyAudienceCriterionSchema)
  .min(1, "Defina o público-alvo da enquete.")
  .max(200, "Limite de 200 critérios de segmentação.");

export type SurveyAudienceInput = z.input<typeof surveyAudienceSchema>;

// ----------------------------------------------------------------------------
// Agendamento (§35)
// ----------------------------------------------------------------------------

export const surveyScheduleSchema = z
  .object({
    scheduledAt: scheduledInstantSchema,
    startsAt: optional(scheduledInstantSchema),
    endsAt: scheduledInstantSchema,
  })
  .refine((d) => !d.startsAt || Date.parse(d.endsAt) > Date.parse(d.startsAt), {
    message: "A data de encerramento deve ser posterior à data de início.",
    path: ["endsAt"],
  })
  .refine((d) => !d.startsAt || Date.parse(d.scheduledAt) >= Date.parse(d.startsAt), {
    message: "O envio não pode ser anterior ao início da enquete.",
    path: ["scheduledAt"],
  });

export type SurveyScheduleInput = z.input<typeof surveyScheduleSchema>;

/** §59. O motivo do cancelamento é opcional — o §59 não o exige, ao contrário de Palestras. */
export const surveyCancelSchema = z.object({
  reason: optional(z.string().trim().max(1000, "Motivo muito longo (máximo de 1000 caracteres).")),
});

// ----------------------------------------------------------------------------
// Listagem (§67, §68)
// ----------------------------------------------------------------------------

export const surveyFiltersSchema = z.object({
  query: optional(z.string().trim().max(120)),
  status: z.enum(SURVEY_STATUSES).optional(),
  from: optional(instantSchema),
  to: optional(instantSchema),
  sort: z.enum(SURVEY_SORT_FIELDS).default("createdAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type SurveyFiltersInput = z.input<typeof surveyFiltersSchema>;

// ----------------------------------------------------------------------------
// A porta do chatbot (§73)
// ----------------------------------------------------------------------------

/**
 * O que o chatbot manda para registrar uma resposta.
 *
 * `sourceMessageId` é a idempotência do §73: o mesmo webhook reentregue não vira
 * segunda resposta. Opcional porque nem todo canal fornece um id de mensagem — e
 * sem ele o sistema ainda funciona, só perde a proteção contra retry técnico.
 */
export const surveyResponseSchema = z.object({
  surveyId: uuidSchema,
  optionId: uuidSchema,
  contactId: uuidSchema,
  sourceMessageId: optional(z.string().trim().min(1).max(200)),
});

export type SurveyResponseInput = z.input<typeof surveyResponseSchema>;

/**
 * A resposta CRUA da pessoa no WhatsApp: o número da alternativa.
 *
 * Existe separado de `surveyResponseSchema` porque são momentos diferentes — um
 * é o que a pessoa digitou, o outro é o que o sistema resolveu que aquilo
 * significa. `resolveOptionByPosition` faz a ponte.
 */
export const surveyReplySchema = z.object({
  surveyId: uuidSchema,
  contactId: uuidSchema,
  reply: z.string().trim().min(1).max(200),
  sourceMessageId: optional(z.string().trim().min(1).max(200)),
});

export type SurveyReplyInput = z.input<typeof surveyReplySchema>;
