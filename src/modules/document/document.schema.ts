import { z } from "zod";
import {
  MAX_PDF_SIZE_BYTES,
  PDF_EXTENSION,
  PDF_MIME_TYPE,
  validatePdfCandidate,
  type PdfUploadIssue,
} from "@/lib/files/pdf";

/**
 * Contratos de entrada da gestão documental. Os mesmos schemas rodam no cliente
 * (React Hook Form) e dentro das actions — defesa em profundidade.
 */

/**
 * As regras de ARQUIVO moram em `src/lib/files/pdf.ts`, porque Documentos e
 * Bolsa fazem a mesma pergunta sobre o mesmo formato. O que fica aqui é o
 * CONTRATO do módulo: as telas continuam importando destes nomes, e o dia em
 * que o limite mudar ele muda num lugar só.
 *
 * O limite de 5 MB ainda aparece em outros três lugares — o `file_size_limit`
 * do bucket, o CHECK de `document_versions` e o `accept` do dropzone. Quatro
 * barreiras independentes: se uma for contornada, as outras seguem de pé.
 */
export const MAX_FILE_SIZE_BYTES = MAX_PDF_SIZE_BYTES;
export const ACCEPTED_MIME_TYPE = PDF_MIME_TYPE;
export const ACCEPTED_EXTENSION = PDF_EXTENSION;

/** Cadastro de uma nova normativa. Os limites batem com os CHECKs da tabela. */
export const documentFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Informe o nome da normativa.")
    .max(160, "Nome muito longo (máximo de 160 caracteres)."),
  description: z.string().trim().max(2000, "Descrição muito longa.").optional(),
});

export type DocumentFormData = z.infer<typeof documentFormSchema>;

/**
 * Data de vigência: AAAA-MM-DD, o formato que o `<input type="date">` produz e
 * que o Postgres aceita em coluna `date`.
 *
 * O `refine` existe porque a regex sozinha aprova "2026-02-31". Reconstruir a
 * string a partir da data interpretada é o que separa uma data possível de uma
 * data que só parece uma data.
 *
 * Vigência passada ou futura são ambas válidas: quem manda na normativa oficial
 * é o status ATIVO, não o calendário. Uma versão pode ser publicada hoje para
 * valer só no mês que vem, ou registrada depois de já estar valendo.
 */
export const effectiveDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de vigência.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, "Data de vigência inválida.");

/** O formulário de upload — só o que a pessoa digita. O arquivo vai à parte. */
export const documentUploadFormSchema = z.object({
  effectiveDate: effectiveDateSchema,
});

export type DocumentUploadFormData = z.infer<typeof documentUploadFormSchema>;

/** Pedido de URL assinada para envio. Roda antes de qualquer byte subir. */
export const uploadTicketSchema = z.object({
  documentId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});

export type UploadTicketInput = z.infer<typeof uploadTicketSchema>;

/** Confirmação depois que o arquivo já está no bucket. */
export const createVersionSchema = z.object({
  documentId: z.string().uuid(),
  storagePath: z.string().min(1).max(512),
  originalFilename: z.string().trim().min(1).max(255),
  effectiveDate: effectiveDateSchema,
});

export type CreateVersionInput = z.infer<typeof createVersionSchema>;

/**
 * Ativar e inativar são COMANDOS, não um estado a escolher. Quem decide
 * `activated_at`, `activated_by` e qual versão sai do ar é o servidor — um
 * formulário que mandasse o estado pronto deixaria o cliente escrever
 * "ativada semana passada por outra pessoa".
 */
export const VERSION_COMMANDS = ["activate", "deactivate"] as const;
export type VersionCommand = (typeof VERSION_COMMANDS)[number];

export const versionCommandSchema = z.object({
  versionId: z.string().uuid(),
  command: z.enum(VERSION_COMMANDS),
});

export type VersionCommandInput = z.infer<typeof versionCommandSchema>;

/** Ver no navegador ou baixar — muda só o cabeçalho da URL assinada. */
export const VERSION_URL_MODES = ["view", "download"] as const;
export type VersionUrlMode = (typeof VERSION_URL_MODES)[number];

export const versionUrlSchema = z.object({
  versionId: z.string().uuid(),
  mode: z.enum(VERSION_URL_MODES),
});

export type VersionUrlInput = z.infer<typeof versionUrlSchema>;

/**
 * O que há de errado com o arquivo escolhido — ou `null` se estiver tudo bem.
 *
 * Devolve o CÓDIGO do problema, não a mensagem: assim o dropzone e a action
 * chegam à mesma conclusão a partir da mesma função, e o texto vem de um lugar
 * só (`ACTION_ERROR_MESSAGES`). Duas validações com dois textos diferentes para
 * o mesmo arquivo é como o usuário descobre que o sistema se contradiz.
 *
 * Aqui só dá para checar o que o navegador informa. Se o arquivo é mesmo um PDF
 * e se pede senha, só o servidor descobre — ver `inspectPdf` em
 * `src/lib/files/pdf.ts`.
 */
export type UploadIssue = PdfUploadIssue;

export const validateUploadCandidate = validatePdfCandidate;
