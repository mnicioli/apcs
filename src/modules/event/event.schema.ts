import { z } from "zod";

/**
 * Contratos de entrada de Eventos. Os mesmos schemas rodam no cliente (React
 * Hook Form) e dentro das actions — defesa em profundidade.
 */

/**
 * 5 MB exatos. O escopo é explícito: um arquivo com exatamente 5 MB deve ser
 * ACEITO, então a comparação é `<=`, nunca `<`.
 *
 * Este mesmo número aparece em outros três lugares — o `file_size_limit` do
 * bucket `events`, o CHECK de `events.image_size_bytes` e a conferência dos
 * bytes que chegaram. Quatro barreiras independentes: se uma for contornada,
 * as outras seguem de pé.
 */
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Extensão → MIME que os BYTES precisam confirmar.
 *
 * O mapa é a regra inteira de tipos de imagem do módulo, num lugar só. `.jpg` e
 * `.jpeg` apontam para o mesmo MIME porque são o mesmo formato com dois nomes.
 */
export const IMAGE_EXTENSION_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const ACCEPTED_IMAGE_EXTENSIONS = Object.keys(IMAGE_EXTENSION_MIME);
export const ACCEPTED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedImageMime = (typeof ACCEPTED_IMAGE_MIMES)[number];

/** O `accept` do input de arquivo: "image/jpeg,image/png,image/webp,.jpg,..." */
export const IMAGE_ACCEPT_ATTRIBUTE = [...ACCEPTED_IMAGE_MIMES, ...ACCEPTED_IMAGE_EXTENSIONS].join(
  ",",
);

/** A extensão em minúsculas, com o ponto — ou `null` se o nome não tiver uma. */
export function imageExtensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return null;
  return filename.slice(dot).toLowerCase();
}

/**
 * O que há de errado com a imagem escolhida — ou `null` se estiver tudo bem.
 *
 * Devolve o CÓDIGO do problema, não a mensagem: assim o campo de upload e a
 * action chegam à mesma conclusão a partir da mesma função, e o texto vem de um
 * lugar só (`ACTION_ERROR_MESSAGES`). Duas validações com dois textos diferentes
 * para o mesmo arquivo é como o usuário descobre que o sistema se contradiz.
 *
 * Aqui só dá para checar o que o navegador informa. Se o arquivo é MESMO uma
 * imagem, só o servidor descobre — ver `src/lib/events/image.ts`.
 */
export type ImageUploadIssue = "fileNotImage" | "fileTooLarge";

export function validateImageCandidate(file: {
  name: string;
  size: number;
  type: string;
}): ImageUploadIssue | null {
  const extension = imageExtensionOf(file.name);
  if (!extension || !(extension in IMAGE_EXTENSION_MIME)) return "fileNotImage";

  // `type` vem vazio em alguns navegadores/sistemas; nesse caso a extensão é o
  // que sobra. Reprovar por MIME ausente barraria upload legítimo, e a
  // verificação que vale mesmo acontece no servidor, sobre os bytes.
  const declared = file.type;
  if (declared !== "" && !(ACCEPTED_IMAGE_MIMES as readonly string[]).includes(declared)) {
    return "fileNotImage";
  }

  // Arquivo vazio é "não é imagem", não "é grande demais": nenhuma imagem tem
  // zero bytes, e dizer o contrário mandaria a pessoa procurar um problema de
  // tamanho que não existe.
  if (file.size <= 0) return "fileNotImage";
  if (file.size > MAX_IMAGE_SIZE_BYTES) return "fileTooLarge";

  return null;
}

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

/** Hora no formato HH:MM, que é o que o `<input type="time">` produz. */
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Informe um horário válido (HH:MM).");

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
