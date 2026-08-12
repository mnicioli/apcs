import { z } from "zod";

/**
 * Contratos de entrada da gestão documental. Os mesmos schemas rodam no cliente
 * (React Hook Form) e dentro das actions — defesa em profundidade.
 */

/**
 * 5 MB exatos. O item 13 do escopo é explícito: um arquivo com exatamente 5 MB
 * deve ser ACEITO, então a comparação é `<=`, nunca `<`.
 *
 * Este mesmo número aparece em outros três lugares — o `file_size_limit` do
 * bucket, o CHECK de `document_versions` e o `accept` do dropzone. Quatro
 * barreiras independentes: se uma for contornada, as outras seguem de pé.
 */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export const ACCEPTED_MIME_TYPE = "application/pdf";
export const ACCEPTED_EXTENSION = ".pdf";

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
 * e se pede senha, só o servidor descobre — ver `src/lib/documents/pdf.ts`.
 */
export type UploadIssue = "fileNotPdf" | "fileTooLarge";

export function validateUploadCandidate(file: {
  name: string;
  size: number;
  type: string;
}): UploadIssue | null {
  const hasPdfExtension = file.name.toLowerCase().endsWith(ACCEPTED_EXTENSION);
  // `type` vem vazio em alguns navegadores/sistemas; nesse caso a extensão é o
  // que sobra. Reprovar por MIME ausente barraria upload legítimo, e a
  // verificação que vale mesmo acontece no servidor.
  const hasPdfMime = file.type === "" || file.type === ACCEPTED_MIME_TYPE;
  if (!hasPdfExtension || !hasPdfMime) return "fileNotPdf";

  // Arquivo vazio é "não é PDF", não "é grande demais": nenhum PDF tem zero
  // bytes, e dizer o contrário mandaria a pessoa procurar um problema de
  // tamanho que não existe.
  if (file.size <= 0) return "fileNotPdf";
  if (file.size > MAX_FILE_SIZE_BYTES) return "fileTooLarge";

  return null;
}
