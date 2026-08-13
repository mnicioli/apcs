import { z } from "zod";

/**
 * Contratos de entrada da Bolsa. Os mesmos schemas rodam no cliente (React Hook
 * Form) e dentro das actions — defesa em profundidade.
 *
 * As regras de ARQUIVO moram em `src/lib/files/` e são as mesmas de Documentos
 * (PDF) e Eventos (imagem). Reexportadas aqui para as telas da Bolsa terem um
 * contrato só, sem atravessar a fronteira de outro módulo.
 */
export {
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_IMAGE_SIZE_BYTES,
  validateImageCandidate,
  type ImageUploadIssue,
} from "@/lib/files/image";

export {
  MAX_PDF_SIZE_BYTES,
  PDF_EXTENSION,
  validatePdfCandidate,
  type PdfUploadIssue,
} from "@/lib/files/pdf";

/**
 * Cadastro de uma Bolsa. Os limites batem com os CHECKs da tabela.
 *
 * ⚠️ `chatbotEnabled` NASCE LIGADO — e isso é uma decisão de MVP, não uma
 * consequência técnica. O raciocínio: uma Bolsa existe para ser divulgada, e
 * cadastrar uma que o robô ignora em silêncio é a falha mais provável de
 * acontecer sem ninguém perceber. O campo é editável a qualquer momento, e a
 * escolha aparece no formulário em vez de ficar implícita. Está registrado como
 * pendência de confirmação do negócio em docs/BOLSA.md.
 */
export const bulletinFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Informe o nome da Bolsa.")
    .max(160, "Nome muito longo (máximo de 160 caracteres)."),
  description: z.string().trim().max(2000, "Descrição muito longa.").optional(),
  chatbotEnabled: z.boolean().default(true),
});

export type BulletinFormData = z.infer<typeof bulletinFormSchema>;

/**
 * Data de vigência: AAAA-MM-DD, o formato que o `<input type="date">` produz e
 * que o Postgres aceita em coluna `date`.
 *
 * O `refine` existe porque a regex sozinha aprova "2026-02-31". Reconstruir a
 * string a partir da data interpretada é o que separa uma data possível de uma
 * data que só parece uma data.
 *
 * ⚠️ PASSADO, HOJE E FUTURO SÃO TODOS VÁLIDOS — de propósito, e ao contrário de
 * Eventos. Publicar hoje algo que passa a valer dia 15 é rotina; registrar uma
 * republicação com a vigência que ela realmente teve também. Quem manda no
 * boletim oficial é o status ATIVO combinado com a vigência, não o calendário
 * sozinho.
 */
export const effectiveDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de vigência.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, "Data de vigência inválida.");

/** O formulário de publicação — só o que a pessoa digita. Os arquivos vão à parte. */
export const publishFormSchema = z.object({
  effectiveDate: effectiveDateSchema,
});

export type PublishFormData = z.infer<typeof publishFormSchema>;

/**
 * Qual dos dois arquivos da publicação.
 *
 * O par é indivisível, mas o UPLOAD é um arquivo de cada vez — e o endereço no
 * bucket depende de qual deles é.
 */
export const BULLETIN_FILE_KINDS = ["image", "pdf"] as const;
export type BulletinFileKind = (typeof BULLETIN_FILE_KINDS)[number];

/**
 * Pedido de URL assinada para envio. Roda antes de qualquer byte subir.
 *
 * `versionId` vem do CLIENTE porque os dois arquivos precisam ir para a pasta
 * da mesma publicação antes de a linha existir. Não é uma brecha: o id só vira
 * uma versão de verdade se a confirmação passar por todas as validações, e os
 * CHECKs de escopo do banco conferem que os caminhos gravados correspondem a
 * ele. Um id sorteado que nunca é confirmado deixa, no máximo, arquivo órfão —
 * que a própria action apaga.
 */
export const uploadTicketSchema = z.object({
  bulletinId: z.string().uuid(),
  versionId: z.string().uuid(),
  kind: z.enum(BULLETIN_FILE_KINDS),
  filename: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});

export type UploadTicketInput = z.infer<typeof uploadTicketSchema>;

/**
 * Confirmação depois que os DOIS arquivos já estão no bucket.
 *
 * Imagem e PDF são obrigatórios no mesmo schema de propósito: não existe
 * caminho no contrato que crie uma publicação pela metade. O escopo é explícito
 * — faltando um dos dois, a operação é recusada.
 */
export const createVersionSchema = z.object({
  bulletinId: z.string().uuid(),
  versionId: z.string().uuid(),
  effectiveDate: effectiveDateSchema,
  imagePath: z.string().min(1).max(512),
  imageFilename: z.string().trim().min(1).max(255),
  pdfPath: z.string().min(1).max(512),
  pdfFilename: z.string().trim().min(1).max(255),
});

export type CreateVersionInput = z.infer<typeof createVersionSchema>;

/**
 * Ativar e inativar são COMANDOS, não um estado a escolher. Quem decide
 * `activated_at`, `activated_by` e qual versão sai do ar é o servidor — um
 * formulário que mandasse o estado pronto deixaria o cliente escrever
 * "ativada semana passada por outra pessoa".
 *
 * `bulletinId` acompanha o comando para o servidor poder recusar "ativar a
 * versão de outra Bolsa" com uma mensagem que diz isso (MB002).
 */
export const VERSION_COMMANDS = ["activate", "deactivate"] as const;
export type VersionCommand = (typeof VERSION_COMMANDS)[number];

export const versionCommandSchema = z.object({
  bulletinId: z.string().uuid(),
  versionId: z.string().uuid(),
  command: z.enum(VERSION_COMMANDS),
});

export type VersionCommandInput = z.infer<typeof versionCommandSchema>;

/** Ver no navegador ou baixar — muda só o cabeçalho da URL assinada. */
export const FILE_URL_MODES = ["view", "download"] as const;
export type FileUrlMode = (typeof FILE_URL_MODES)[number];

export const fileUrlSchema = z.object({
  versionId: z.string().uuid(),
  kind: z.enum(BULLETIN_FILE_KINDS),
  mode: z.enum(FILE_URL_MODES),
});

export type FileUrlInput = z.infer<typeof fileUrlSchema>;

/** Edição do cadastro. */
export const updateBulletinSchema = bulletinFormSchema.and(
  z.object({ bulletinId: z.string().uuid() }),
);

export type UpdateBulletinInput = z.infer<typeof updateBulletinSchema>;
