import { z } from "zod";

/**
 * Contratos de entrada de Eventos. Os mesmos schemas rodam no cliente (React
 * Hook Form) e dentro das actions — defesa em profundidade.
 */

/**
 * As regras de IMAGEM moram em `src/lib/files/image.ts`, porque Eventos e Bolsa
 * fazem a mesma pergunta sobre os mesmos formatos. O que fica aqui é o CONTRATO
 * do módulo: as telas continuam importando destes nomes, e o dia em que a
 * plataforma aceitar um formato novo ele entra num lugar só.
 *
 * O limite de 5 MB ainda aparece em outros três lugares — o `file_size_limit`
 * do bucket `events`, o CHECK de `events.image_size_bytes` e a conferência dos
 * bytes que chegaram. Quatro barreiras independentes.
 */
export {
  ACCEPTED_IMAGE_EXTENSIONS,
  ACCEPTED_IMAGE_MIMES,
  IMAGE_ACCEPT_ATTRIBUTE,
  IMAGE_EXTENSION_MIME,
  MAX_IMAGE_SIZE_BYTES,
  imageExtensionOf,
  validateImageCandidate,
  type AcceptedImageMime,
  type ImageUploadIssue,
} from "@/lib/files/image";
import { isOnTimeStep, TIME_STEP_MESSAGE } from "@/lib/time/step";

/**
 * Data do evento: AAAA-MM-DD, o formato que o `<input type="date">` produz e que
 * o Postgres aceita em coluna `date`.
 *
 * O `refine` existe porque a regex sozinha aprova "2026-02-31". Reconstruir a
 * string a partir da data interpretada é o que separa uma data possível de uma
 * data que só parece uma data.
 */
export const eventDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do evento.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, "Data do evento inválida.");

/**
 * Hora no formato HH:MM, que é o que o `<input type="time">` produz.
 *
 * ⚠️ O PASSO É VALIDADO AQUI, E NÃO SÓ NO `step` DO CAMPO. O formulário é
 * `noValidate` (as mensagens são do Zod, não do navegador), então `step` mexe
 * apenas na LISTA que o seletor oferece — quem digitar 08:07 direto na caixa,
 * ou chamar a Server Action por fora, passaria batido. Esta é a regra de
 * verdade; o `step` é a conveniência.
 *
 * ⚠️ NÃO HÁ CHECK EQUIVALENTE NO BANCO, e é decisão. Um evento antigo gravado
 * com 08:07 faria o CHECK recusar QUALQUER update daquela linha — trocar o nome
 * do evento falharia por causa do horário. Isto é política de apresentação
 * ("que horários a APCS oferece"), não invariante de integridade ("que horários
 * existem"), e as duas não merecem a mesma dureza.
 */
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Informe um horário válido (HH:MM).")
  .refine(isOnTimeStep, { message: TIME_STEP_MESSAGE });

/**
 * O link de inscrição — DADO EXTERNO NÃO CONFIÁVEL.
 *
 * ⚠️ `z.string().url()` ACEITA `javascript:alert(1)`, porque é uma URL válida.
 * Colocado num `href`, isso é XSS na tela de quem clicar. Por isso a validação
 * é uma allowlist explícita de protocolo, e não `.url()`.
 *
 * A mesma regra está no CHECK `events_url_scheme` da tabela: se alguém chamar o
 * PostgREST direto, o banco recusa igual.
 */
export function isSafeHttpUrl(value: string): boolean {
  // Espaço em branco quebraria o CHECK do banco, que exige uma URL sem
  // espaços — recusar aqui dá a mensagem certa em vez de um "dados inválidos".
  if (/\s/.test(value)) return false;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

export const registrationUrlSchema = z
  .string()
  .trim()
  .max(2048, "Link muito longo.")
  .refine(
    (value) => value === "" || isSafeHttpUrl(value),
    "Informe um link válido (http ou https).",
  )
  .optional();

/**
 * O formulário do evento — tudo que a pessoa digita. A imagem vai à parte,
 * porque é um arquivo e não passa por Server Action (ver a action de upload).
 *
 * A ordem dos horários é validada no nível do OBJETO, e não do campo, porque
 * precisa dos dois valores. O mesmo teste existe como CHECK `events_time_order`
 * na tabela.
 */
export const eventFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Informe o nome do evento.")
      .max(160, "Nome muito longo (máximo de 160 caracteres)."),
    location: z
      .string()
      .trim()
      .min(2, "Informe o local do evento.")
      .max(200, "Local muito longo (máximo de 200 caracteres)."),
    registrationUrl: registrationUrlSchema,
    eventDate: eventDateSchema,
    startTime: timeSchema,
    endTime: z.union([timeSchema, z.literal("")]).optional(),
    segmentIds: z.array(z.string().uuid()).min(1, "Selecione ao menos um público-alvo."),
  })
  .refine((data) => !data.endTime || data.endTime >= data.startTime, {
    // Comparação de string em "HH:MM" é a comparação de relógio — 24 h em
    // ordem lexicográfica é a mesma ordem cronológica.
    message: "O horário de término não pode ser anterior ao horário de início.",
    path: ["endTime"],
  });

export type EventFormData = z.infer<typeof eventFormSchema>;

/**
 * O formulário de CADASTRO: o de cima mais a regra de que o evento não pode
 * nascer no passado.
 *
 * É uma fábrica, e não um schema pronto, porque "hoje" é um dado — assim o teste
 * não depende do dia em que roda e a página decide o "hoje" uma vez só. O banco
 * impõe a mesma regra em `create_event` (EV003); esta camada existe para a
 * pessoa ver a mensagem no campo em vez de depois de enviar.
 */
export function createEventFormSchema(today: string) {
  return eventFormSchema.refine((data) => data.eventDate >= today, {
    message: EVENT_DATE_IN_PAST_MESSAGE,
    path: ["eventDate"],
  });
}

/**
 * O texto único para "data no passado".
 *
 * É o MESMO de `ACTION_ERROR_MESSAGES.eventDateInPast` — um teste garante isso.
 * Duas mensagens para a mesma regra é como o usuário descobre que o formulário e
 * o servidor discordam.
 */
export const EVENT_DATE_IN_PAST_MESSAGE =
  "Não é possível cadastrar um evento com data anterior à data atual.";

/**
 * O formulário de EDIÇÃO.
 *
 * MOVER a data para o passado é recusado; MANTER uma data que já passou não.
 * Sem essa distinção, um evento expirado ficaria impossível de editar — nem
 * para corrigir o local no registro, nem para remarcá-lo, porque qualquer
 * edição carrega a data atual dele junto.
 *
 * É exatamente a regra que `update_event` impõe no Postgres (EV003). O
 * formulário a espelha para a mensagem aparecer no campo; a autoridade continua
 * sendo o banco.
 */
export function editEventFormSchema(today: string, originalDate: string) {
  return eventFormSchema.refine(
    (data) => data.eventDate === originalDate || data.eventDate >= today,
    { message: EVENT_DATE_IN_PAST_MESSAGE, path: ["eventDate"] },
  );
}

/** Pedido de URL assinada para envio da imagem. Roda antes de qualquer byte subir. */
export const imageUploadTicketSchema = z.object({
  /**
   * Só na EDIÇÃO. No cadastro o id ainda não existe — quem o sorteia é o
   * servidor, para o caminho da imagem já nascer dentro da pasta do evento.
   */
  eventId: z.string().uuid().optional(),
  filename: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});

export type ImageUploadTicketInput = z.infer<typeof imageUploadTicketSchema>;

/** Confirmação de cadastro, depois que a imagem já está no bucket. */
export const createEventSchema = eventFormSchema.and(
  z.object({
    eventId: z.string().uuid(),
    storagePath: z.string().min(1).max(512),
  }),
);

export type CreateEventInput = z.infer<typeof createEventSchema>;

/** Edição. `storagePath` ausente significa MANTER a imagem atual. */
export const updateEventSchema = eventFormSchema.and(
  z.object({
    eventId: z.string().uuid(),
    storagePath: z.string().min(1).max(512).optional(),
  }),
);

export type UpdateEventInput = z.infer<typeof updateEventSchema>;

/**
 * Ativar e inativar são COMANDOS, não um estado a escolher. Quem decide o
 * `updated_by`, o carimbo de tempo e se a data permite a ativação é o servidor —
 * um formulário que mandasse `{ status: "ACTIVE" }` pronto deixaria o cliente
 * afirmar um estado em vez de pedir uma transição.
 */
export const EVENT_COMMANDS = ["activate", "deactivate"] as const;
export type EventCommand = (typeof EVENT_COMMANDS)[number];

export const eventCommandSchema = z.object({
  eventId: z.string().uuid(),
  command: z.enum(EVENT_COMMANDS),
});

export type EventCommandInput = z.infer<typeof eventCommandSchema>;

/**
 * Divulgar. Um id, e mais nada.
 *
 * ⚠️ NÃO RECEBE A LISTA DE DESTINATÁRIOS, e isso é a decisão de segurança
 * central deste fluxo. Quem monta a fila é `start_event_dispatch`, no banco, a
 * partir dos públicos-alvo gravados no evento. Se a tela mandasse a lista, uma
 * requisição forjada escolheria para quem a APCS manda WhatsApp — e o servidor
 * não teria como saber que aquela não era a audiência do evento.
 */
export const dispatchEventSchema = z.object({
  eventId: z.string().uuid(),
});

export type DispatchEventInput = z.infer<typeof dispatchEventSchema>;
