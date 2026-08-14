import { z } from "zod";
import {
  LECTURE_FORMATS,
  LECTURE_PRIORITIES,
  LECTURE_SORT_FIELDS,
  LECTURE_STATUSES,
  LECTURE_TYPES,
} from "./lecture.types";

/**
 * Contratos de entrada de Palestras. Os mesmos schemas rodam no cliente (React
 * Hook Form) e dentro das actions — defesa em profundidade.
 *
 * Cada limite aqui tem um gêmeo como CHECK na tabela. O Zod existe para a
 * pessoa ver a mensagem no campo; a autoridade continua sendo o banco, que
 * recusa igual se alguém chamar o PostgREST direto.
 */

// ----------------------------------------------------------------------------
// Peças reaproveitadas
// ----------------------------------------------------------------------------

/**
 * Data no formato AAAA-MM-DD, que é o que o `<input type="date">` produz e o
 * Postgres aceita em coluna `date`.
 *
 * O `refine` existe porque a regex sozinha aprova "2026-02-31". Reconstruir a
 * string a partir da data interpretada é o que separa uma data possível de uma
 * data que só parece uma data.
 */
export const lectureDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data da palestra.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, "Data inválida.");

/** Hora no formato HH:MM, que é o que o `<input type="time">` produz. */
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Informe um horário válido (HH:MM).");

/** Campo de hora opcional: string vazia significa "não informado". */
const optionalTimeSchema = z.union([timeSchema, z.literal("")]).optional();

/**
 * Telefone: dígitos e a pontuação que as pessoas realmente digitam.
 *
 * Não valida operadora nem DDD — o objetivo é impedir que "asdf" vire o único
 * contato de uma solicitação, não provar que o número atende. Mesma regra do
 * CHECK `lectures_requester_phone`.
 */
const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9()+ .-]{8,20}$/, "Informe um telefone válido.");

const emailSchema = z.string().trim().email("Informe um e-mail válido.").max(160);

/** Aceita string vazia como "não informado", em vez de exigir `undefined`. */
function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, z.literal("")]).optional();
}

/**
 * Participantes estimados — como STRING, e não como número.
 *
 * ⚠️ Parece um detalhe e não é. Um `<input type="number">` guarda uma STRING; o
 * React Hook Form recebe uma string. Se o schema usasse `z.coerce.number()`, o
 * tipo de ENTRADA (o que o formulário segura) deixaria de bater com o de SAÍDA
 * (o que sai validado), e `useForm<z.infer<...>>` passaria a discordar do
 * resolver — foi exatamente o que o TypeScript recusou aqui.
 *
 * Mantendo string dos dois lados, o formulário e o schema falam a mesma língua e
 * a conversão acontece num lugar só: a action, ao montar a chamada do banco. É o
 * mesmo desenho dos outros formulários do projeto.
 *
 * Vazio é "não informado" — que no banco é NULL, não zero (§18).
 */
const attendeesEstimatedSchema = z
  .string()
  .trim()
  .regex(/^\d*$/, "Informe apenas números.")
  .refine((value) => value === "" || Number(value) > 0, "Informe um número maior que zero.")
  .optional();

// ----------------------------------------------------------------------------
// O núcleo do formulário
// ----------------------------------------------------------------------------

/**
 * Os campos que descrevem a palestra. É a base do cadastro interno e da
 * solicitação do chatbot — as duas perguntam as mesmas coisas sobre o mesmo
 * assunto, e o que muda é o que cada uma PODE definir além disto.
 *
 * ⚠️ A ordem dos horários é validada no nível do OBJETO, e não do campo, porque
 * precisa dos dois valores. O mesmo teste existe como CHECK
 * `lectures_time_order` na tabela — e lá, como aqui, o término é ESTRITAMENTE
 * maior que o início (§13): uma palestra que termina quando começa não é uma
 * palestra.
 */
export const lectureCoreSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Informe o nome da palestra.")
      .max(160, "Nome muito longo (máximo de 160 caracteres)."),
    theme: z
      .string()
      .trim()
      .min(2, "Informe o tema da palestra.")
      .max(200, "Tema muito longo (máximo de 200 caracteres)."),
    city: z
      .string()
      .trim()
      .min(2, "Informe a cidade.")
      .max(120, "Cidade muito longa (máximo de 120 caracteres)."),
    location: optional(
      z.string().trim().min(2, "Local muito curto.").max(200, "Local muito longo."),
    ),
    type: z.enum(LECTURE_TYPES, { errorMap: () => ({ message: "Selecione o tipo." }) }),
    typeOther: optional(
      z.string().trim().min(2, "Descreva o tipo.").max(120, "Descrição muito longa."),
    ),
    format: z.union([z.enum(LECTURE_FORMATS), z.literal("")]).optional(),
    eventDate: lectureDateSchema,
    startTime: optionalTimeSchema,
    endTime: optionalTimeSchema,
    attendeesEstimated: attendeesEstimatedSchema,
    notes: optional(z.string().trim().max(2000, "Observações muito longas (máximo de 2000).")),
  })
  // §8. `other` EXIGE o detalhe. O CHECK da tabela impõe também o inverso
  // (qualquer outro tipo PROÍBE o detalhe), mas isso não vira erro de
  // formulário: quem troca o tipo não deve ser obrigado a limpar um campo que
  // já sumiu da tela — a função `update_lecture` descarta o valor sozinha.
  .refine((data) => data.type !== "other" || Boolean(data.typeOther), {
    message: "Descreva o tipo quando escolher “Outros”.",
    path: ["typeOther"],
  })
  .refine((data) => !data.endTime || Boolean(data.startTime), {
    message: "Informe o horário de início antes do de término.",
    path: ["startTime"],
  })
  .refine((data) => !data.endTime || !data.startTime || data.endTime > data.startTime, {
    // Comparação de string em "HH:MM" é a comparação de relógio — 24 h em ordem
    // lexicográfica é a mesma ordem cronológica.
    message: "O horário de término deve ser posterior ao de início.",
    path: ["endTime"],
  });

export type LectureCoreData = z.infer<typeof lectureCoreSchema>;

// ----------------------------------------------------------------------------
// Cadastro interno (§28)
// ----------------------------------------------------------------------------

/**
 * Os status com que o time interno pode CRIAR uma palestra.
 *
 * Espelha os pontos de entrada do grafo no banco. Está duplicado aqui de
 * propósito e com um custo aceito: o formulário precisa montar o seletor antes
 * de qualquer ida ao servidor. O banco continua sendo quem recusa (PL001) — se
 * as duas listas divergirem, o pior que acontece é uma opção na tela que o
 * servidor rejeita com mensagem clara, nunca uma escrita indevida.
 */
export const LECTURE_ENTRY_STATUSES = ["requested", "planned", "confirmed", "held"] as const;

export const createLectureSchema = lectureCoreSchema.and(
  z.object({
    status: z.enum(LECTURE_ENTRY_STATUSES),
    // Sem `.default()`: um default faz o tipo de ENTRADA divergir do de SAÍDA e
    // o resolver do React Hook Form deixa de bater com `useForm`. O formulário
    // sempre manda um valor, e `create_lecture` já faz `coalesce(..., 'normal')`
    // no banco para quem chamar sem.
    priority: z.enum(LECTURE_PRIORITIES),
    speakerId: optional(z.string().uuid()),
    responsibleId: optional(z.string().uuid()),
    requesterName: optional(z.string().trim().min(2).max(160)),
    requesterEmail: optional(emailSchema),
    requesterPhone: optional(phoneSchema),
    requesterOrganization: optional(z.string().trim().min(2).max(160)),
  }),
);

export type CreateLectureInput = z.infer<typeof createLectureSchema>;

/**
 * A checagem que depende dos DOIS lados (status e horário) e por isso não cabe
 * no `and` acima — `ZodIntersection` não aceita `refine` sobre o objeto
 * combinado sem perder a inferência dos dois lados.
 *
 * Devolve a mensagem, ou `null` quando está tudo certo.
 */
export function scheduledNeedsTime(input: { status: string; startTime?: string }): string | null {
  if (input.status !== "confirmed" && input.status !== "held") return null;
  return input.startTime ? null : LECTURE_NEEDS_TIME_MESSAGE;
}

/**
 * O texto único para "falta horário".
 *
 * É o MESMO de `ACTION_ERROR_MESSAGES.lectureNeedsTime` — um teste garante
 * isso. Duas mensagens para a mesma regra é como o usuário descobre que o
 * formulário e o servidor discordam.
 */
export const LECTURE_NEEDS_TIME_MESSAGE = "Informe o horário de início para confirmar a palestra.";

// ----------------------------------------------------------------------------
// Edição (§42)
// ----------------------------------------------------------------------------

/**
 * A edição NÃO carrega data, horário nem status — cada um tem a sua operação
 * (§43, §44). Não é rigor formal: é o que permite auditar "remarcou" e "mudou o
 * tema" como coisas diferentes, em vez de esconder um reagendamento no meio de
 * um diff de doze campos.
 */
export const updateLectureSchema = z
  .object({
    lectureId: z.string().uuid(),
    name: z.string().trim().min(2).max(160),
    theme: z.string().trim().min(2).max(200),
    city: z.string().trim().min(2).max(120),
    location: optional(z.string().trim().min(2).max(200)),
    type: z.enum(LECTURE_TYPES),
    typeOther: optional(z.string().trim().min(2).max(120)),
    format: z.union([z.enum(LECTURE_FORMATS), z.literal("")]).optional(),
    attendeesEstimated: attendeesEstimatedSchema,
    priority: z.enum(LECTURE_PRIORITIES),
    notes: optional(z.string().trim().max(2000)),
  })
  .refine((data) => data.type !== "other" || Boolean(data.typeOther), {
    message: "Descreva o tipo quando escolher “Outros”.",
    path: ["typeOther"],
  });

export type UpdateLectureInput = z.infer<typeof updateLectureSchema>;

// ----------------------------------------------------------------------------
// Status, agenda e atribuições (§43, §44, §45, §46)
// ----------------------------------------------------------------------------

/**
 * Mudar de status é pedir uma TRANSIÇÃO, não afirmar um estado.
 *
 * O cliente diz para onde quer ir; quem decide se aquele caminho existe, quem
 * assina e quando é o servidor. O motivo é obrigatório para rejeitar e
 * cancelar (§24, §25) e o banco recusa sem ele (PL004) — este `refine` só
 * antecipa a mensagem para o campo certo.
 */
export const lectureStatusSchema = z
  .object({
    lectureId: z.string().uuid(),
    status: z.enum(LECTURE_STATUSES),
    reason: optional(z.string().trim().min(3, "Descreva o motivo.").max(1000)),
  })
  .refine((data) => (data.status !== "rejected" && data.status !== "cancelled") || data.reason, {
    message: "Informe o motivo.",
    path: ["reason"],
  });

export type LectureStatusInput = z.infer<typeof lectureStatusSchema>;

/** Reagendamento — serve ao formulário e ao arrastar-e-soltar do calendário. */
export const rescheduleLectureSchema = z
  .object({
    lectureId: z.string().uuid(),
    eventDate: lectureDateSchema,
    startTime: optionalTimeSchema,
    endTime: optionalTimeSchema,
  })
  .refine((data) => !data.endTime || Boolean(data.startTime), {
    message: "Informe o horário de início antes do de término.",
    path: ["startTime"],
  })
  .refine((data) => !data.endTime || !data.startTime || data.endTime > data.startTime, {
    message: "O horário de término deve ser posterior ao de início.",
    path: ["endTime"],
  });

export type RescheduleLectureInput = z.infer<typeof rescheduleLectureSchema>;

/** Atribuir responsável ou palestrante. `profileId` vazio DESATRIBUI. */
export const assignLectureSchema = z.object({
  lectureId: z.string().uuid(),
  profileId: z.union([z.string().uuid(), z.literal("")]).optional(),
});

export type AssignLectureInput = z.infer<typeof assignLectureSchema>;

/** Registro da realização (§26). Zero participantes é resultado válido. */
export const lectureOutcomeSchema = z.object({
  lectureId: z.string().uuid(),
  heldAt: z.union([lectureDateSchema, z.literal("")]).optional(),
  attendeesActual: z
    .union([
      z.coerce.number().int("Informe um número inteiro.").min(0, "Não pode ser negativo."),
      z.literal(""),
    ])
    .optional(),
  outcomeNotes: optional(z.string().trim().max(2000)),
});

export type LectureOutcomeInput = z.infer<typeof lectureOutcomeSchema>;

// ----------------------------------------------------------------------------
// Chatbot (§7)
// ----------------------------------------------------------------------------

/**
 * O que o chatbot coleta — exatamente o §7, e NADA além.
 *
 * ⚠️ Não há campo de status, prioridade, responsável nem palestrante, e isso
 * não é economia: é o §6. A função do banco também não tem esses parâmetros, e
 * é lá que a garantia mora. Este schema é a primeira das duas barreiras.
 *
 * Os campos obrigatórios são os cinco marcados com `*` no escopo: nome, cidade,
 * tipo, tema e data desejada.
 */
export const lectureRequestSchema = z
  .object({
    requesterName: z.string().trim().min(2, "Informe seu nome.").max(160, "Nome muito longo."),
    city: z.string().trim().min(2, "Informe a cidade.").max(120),
    type: z.enum(LECTURE_TYPES, { errorMap: () => ({ message: "Selecione o tipo." }) }),
    typeOther: optional(z.string().trim().min(2).max(120)),
    theme: z.string().trim().min(2, "Informe o tema desejado.").max(200),
    eventDate: lectureDateSchema,
    startTime: optionalTimeSchema,
    location: optional(z.string().trim().min(2).max(200)),
    format: z.union([z.enum(LECTURE_FORMATS), z.literal("")]).optional(),
    attendeesEstimated: z.union([z.coerce.number().int().positive(), z.literal("")]).optional(),
    notes: optional(z.string().trim().max(2000)),
    requesterEmail: optional(emailSchema),
    requesterPhone: optional(phoneSchema),
    requesterOrganization: optional(z.string().trim().min(2).max(160)),
    /** Vem da conversa, nunca do que a pessoa digitou. */
    requesterContactId: z.string().uuid().optional(),
    /**
     * §59/§60. Chave OPACA para o retry técnico não virar dois protocolos.
     *
     * ⚠️ Quem a gera é o chamador, e ela nunca pode ser derivada do conteúdo do
     * pedido: duas pessoas da mesma cooperativa pedindo o mesmo tema para o
     * mesmo dia são dois pedidos legítimos, e deduplicar por conteúdo
     * transformaria "o sistema me protegeu de um retry" em "o sistema comeu meu
     * pedido". O mínimo de 8 existe para uma chave fraca não colidir entre
     * conversas diferentes — e o banco repete o limite num CHECK.
     */
    idempotencyKey: optional(z.string().trim().min(8).max(128)),
  })
  .refine((data) => data.type !== "other" || Boolean(data.typeOther), {
    message: "Descreva o tipo quando escolher “Outros”.",
    path: ["typeOther"],
  });

export type LectureRequestInput = z.infer<typeof lectureRequestSchema>;

/**
 * Consulta de uma solicitação pelo protocolo (§60).
 *
 * O formato é conferido aqui para uma digitação errada virar "protocolo
 * inválido" em vez de uma consulta ao banco que não acha nada.
 */
export const lectureProtocolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^SOL-\d{6,}$/, "Protocolo inválido. O formato é SOL-000000.");

// ----------------------------------------------------------------------------
// Listagem (§32, §48, §49)
// ----------------------------------------------------------------------------

/** Teto por página. Acima disto a listagem deixa de ser paginação e vira dump. */
export const MAX_LECTURE_PAGE_SIZE = 100;
export const DEFAULT_LECTURE_PAGE_SIZE = 25;

export const lectureQuerySchema = z.object({
  query: z.string().trim().max(120).default(""),
  status: z.array(z.enum(LECTURE_STATUSES)).default([]),
  origin: z.enum(["chatbot", "internal"]).nullable().default(null),
  type: z.enum(LECTURE_TYPES).nullable().default(null),
  format: z.enum(LECTURE_FORMATS).nullable().default(null),
  priority: z.enum(LECTURE_PRIORITIES).nullable().default(null),
  city: z.string().trim().max(120).default(""),
  responsibleId: z.string().uuid().nullable().default(null),
  speakerId: z.string().uuid().nullable().default(null),
  from: z.union([lectureDateSchema, z.literal("")]).default(""),
  to: z.union([lectureDateSchema, z.literal("")]).default(""),
  sortField: z.enum(LECTURE_SORT_FIELDS).default("requestedAt"),
  ascending: z.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_LECTURE_PAGE_SIZE)
    .default(DEFAULT_LECTURE_PAGE_SIZE),
});

export type LectureQueryInput = z.infer<typeof lectureQuerySchema>;

/** O recorte do calendário (§31). Período fechado, inclusivo nas duas pontas. */
export const lectureCalendarSchema = z
  .object({
    startDate: lectureDateSchema,
    endDate: lectureDateSchema,
    status: z.array(z.enum(LECTURE_STATUSES)).default([]),
    city: z.string().trim().max(120).default(""),
    type: z.enum(LECTURE_TYPES).nullable().default(null),
    format: z.enum(LECTURE_FORMATS).nullable().default(null),
    origin: z.enum(["chatbot", "internal"]).nullable().default(null),
    responsibleId: z.string().uuid().nullable().default(null),
    speakerId: z.string().uuid().nullable().default(null),
  })
  .refine((data) => data.startDate <= data.endDate, {
    message: "A data inicial deve ser anterior à final.",
    path: ["endDate"],
  });

export type LectureCalendarInput = z.infer<typeof lectureCalendarSchema>;
