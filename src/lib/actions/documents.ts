"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertPermission } from "@/lib/auth/assert-permission";
import { fail, mapPostgresError, ok, type ActionResult } from "@/lib/actions/errors";
import { inspectPdf } from "@/lib/files/pdf";
import {
  buildStoragePath,
  DOCUMENTS_BUCKET,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/documents/storage";
import { DOCUMENT_ROUTE_PATTERNS } from "@/modules/document/document.routes";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/modules/document/document.types";
import {
  createVersionSchema,
  documentFormSchema,
  MAX_FILE_SIZE_BYTES,
  validateUploadCandidate,
  uploadTicketSchema,
  versionCommandSchema,
  versionUrlSchema,
  type CreateVersionInput,
  type DocumentFormData,
  type UploadTicketInput,
  type VersionCommandInput,
  type VersionUrlInput,
} from "@/modules/document/document.schema";

/**
 * ACTION = escrita. SEMPRE retorna `ActionResult<T>`, NUNCA lança.
 *
 * Ordem obrigatória: validar → autorizar → escrever → mapear erro → revalidar.
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 *
 * O QUE FICA NO BANCO, E POR QUÊ: publicar uma versão são três escritas que
 * precisam acontecer juntas (inativar a atual, criar/ativar a nova, auditar). O
 * supabase-js não faz transação de várias chamadas, então isso é uma função
 * Postgres. Aqui em cima ficam só a autorização e a validação do ARQUIVO — que
 * é o que o banco não tem como fazer.
 */

/**
 * O que as três funções transacionais devolvem: a linha da versão afetada.
 *
 * O tipo precisa ser afirmado na mão porque o `as never` nos argumentos —
 * contorno do descompasso de generics ssr/supabase-js, o mesmo de insert/update
 * (ver CONVENTIONS.md) — colapsa também o tipo do retorno. Os campos abaixo
 * batem com `Database["public"]["Functions"]` em src/types/database.ts.
 */
interface VersionRpcResult {
  id: string;
  document_id: string;
  version: number;
}

/**
 * Invalida o cache das telas de documentos.
 *
 * Usa os PADRÕES de rota (`/documents/[category]`), e não endereços concretos:
 * as funções transacionais devolvem `document_id`, não a categoria, e ir ao
 * banco de novo só para descobrir isso custaria uma consulta por operação.
 * Invalidar as duas categorias numa tela de backoffice não custa nada.
 */
function revalidateDocuments(): void {
  for (const pattern of DOCUMENT_ROUTE_PATTERNS) revalidatePath(pattern, "page");
}

/**
 * URL temporária para ver ou baixar o arquivo de uma versão.
 *
 * É `documents.read` e não `documents.write` de propósito: quem atende precisa
 * consultar a normativa vigente sem poder publicar nada.
 *
 * O cliente manda o `versionId`; o caminho no bucket é resolvido aqui. O
 * navegador nunca vê onde o arquivo mora, e a RLS de `document_versions` é o que
 * decide se essa linha existe para quem está pedindo.
 */
export async function getDocumentVersionUrlAction(
  input: VersionUrlInput,
): Promise<ActionResult<{ url: string }>> {
  const parsed = versionUrlSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<{ url: string }>("documents.read");
  if (denied) return denied;

  const supabase = await createClient();

  const { data: version, error: readError } = await supabase
    .from("document_versions")
    .select("id, document_id, version, storage_path, original_filename")
    .eq("id", parsed.data.versionId)
    .returns<
      {
        id: string;
        document_id: string;
        version: number;
        storage_path: string;
        original_filename: string;
      }[]
    >()
    .maybeSingle();

  if (readError) {
    console.error(`[documents] leitura da versão falhou: ${readError.message}`);
    return { ok: false, error: mapPostgresError(readError) };
  }
  if (!version) return fail("notFound");

  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(
    version.storage_path,
    SIGNED_URL_TTL_SECONDS,
    // Com `download`, o Storage devolve `Content-Disposition: attachment` e o
    // arquivo chega com o nome original — que é o único lugar onde ele importa.
    // Sem a opção, o navegador abre o PDF na tela.
    parsed.data.mode === "download" ? { download: version.original_filename } : undefined,
  );

  if (error || !data) {
    console.error(`[documents] URL assinada falhou: ${error?.message ?? "sem dados"}`);
    return fail("unexpected");
  }

  await recordAccess(version.document_id, version.id, version.version, parsed.data.mode);

  return ok({ url: data.signedUrl });
}

/**
 * Registra na trilha que alguém abriu ou baixou o arquivo.
 *
 * LIMITE HONESTO: o que fica registrado é a EMISSÃO da URL, não cada leitura.
 * Quem guardar o link consegue reabri-lo dentro da validade sem gerar novo
 * evento — é o TTL curto que limita essa janela, não a auditoria.
 *
 * Falha aqui não derruba o acesso: negar a leitura de uma normativa vigente
 * porque o log não gravou seria trocar um problema pequeno por um grande. O
 * erro vai para o servidor, onde alguém pode agir sobre ele.
 */
async function recordAccess(
  documentId: string,
  versionId: string,
  version: number,
  mode: "view" | "download",
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from("document_audit_logs").insert({
    document_id: documentId,
    version_id: versionId,
    action: mode === "download" ? "version_downloaded" : "version_viewed",
    metadata: { version },
  } as never);

  if (error) {
    console.error(`[documents] auditoria de ${mode} não registrada: ${error.message}`);
  }
}

// ----------------------------------------------------------------------------
// Escrita — exige `documents.write` (Administrador e Gestor)
// ----------------------------------------------------------------------------

/** Cadastra um documento novo na categoria. Ele nasce sem arquivo, esperando a v1. */
export async function createDocumentAction(
  category: DocumentCategory,
  input: DocumentFormData,
): Promise<ActionResult<{ id: string }>> {
  // A categoria vem da tela, então é validada como qualquer outra entrada.
  if (!(DOCUMENT_CATEGORIES as readonly string[]).includes(category)) return fail("invalidInput");

  const parsed = documentFormSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<{ id: string }>("documents.write");
  if (denied) return denied;

  const supabase = await createClient();

  // `created_by` não é enviado: a coluna tem `default auth.uid()` e a policy
  // exige que seja igual a ele. Autoria não se declara, se comprova.
  const { data, error } = await supabase
    .from("documents")
    .insert({
      category,
      name: parsed.data.name,
      description: parsed.data.description || null,
    } as never)
    .select("id")
    .returns<{ id: string }[]>()
    .maybeSingle();

  if (error) {
    console.error(`[documents] cadastro de documento falhou: ${error.message}`);
    return { ok: false, error: mapPostgresError(error) };
  }
  if (!data) return fail("unexpected");

  // Auditoria fora da transação do insert, diferente das operações de versão:
  // não há função no banco para este caso. Falhar aqui deixaria a normativa
  // criada sem o evento — perda pequena, que não justifica desfazer o cadastro.
  const { error: auditError } = await supabase.from("document_audit_logs").insert({
    document_id: data.id,
    action: "document_created",
    metadata: { name: parsed.data.name },
  } as never);

  if (auditError) {
    console.error(`[documents] auditoria de cadastro não registrada: ${auditError.message}`);
  }

  revalidateDocuments();
  return ok({ id: data.id });
}

/**
 * Passo 1 do upload: autoriza e devolve um endereço para o navegador enviar o
 * arquivo DIRETO ao Supabase Storage.
 *
 * O arquivo não passa pelo servidor Next por um motivo concreto: a Vercel corta
 * o corpo de qualquer requisição serverless em 4,5 MB, e o limite do módulo é
 * 5 MB. Não é questão de configuração — um PDF de 5 MB simplesmente não chega
 * por Server Action. O que trafega aqui são algumas centenas de bytes.
 */
export async function requestDocumentUploadAction(
  input: UploadTicketInput,
): Promise<ActionResult<{ bucket: string; path: string; token: string }>> {
  type Ticket = { bucket: string; path: string; token: string };

  const parsed = uploadTicketSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<Ticket>("documents.write");
  if (denied) return denied;

  // `type: ""` porque o servidor não vê o MIME que o navegador declarou — aqui
  // só dá para conferir extensão e tamanho. O que o arquivo REALMENTE é fica
  // para o passo 2, depois de ele existir.
  const issue = validateUploadCandidate({
    name: parsed.data.filename,
    size: parsed.data.sizeBytes,
    type: "",
  });
  if (issue) return fail(issue);

  const supabase = await createClient();

  // Confere que a normativa existe ANTES de emitir o endereço: sem isto, o
  // arquivo subiria para uma pasta órfã e só descobriríamos no passo 2.
  const { data: document, error: readError } = await supabase
    .from("documents")
    .select("id")
    .eq("id", parsed.data.documentId)
    .returns<{ id: string }[]>()
    .maybeSingle();

  if (readError) {
    console.error(`[documents] leitura da normativa falhou: ${readError.message}`);
    return { ok: false, error: mapPostgresError(readError) };
  }
  if (!document) return fail("notFound");

  const path = buildStoragePath(parsed.data.documentId);
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path);

  if (error || !data) {
    console.error(`[documents] URL de upload falhou: ${error?.message ?? "sem dados"}`);
    return fail("unexpected");
  }

  return ok({ bucket: DOCUMENTS_BUCKET, path: data.path, token: data.token });
}

/**
 * Passo 2: o arquivo já está no bucket. Agora ele é examinado de verdade e, se
 * passar, vira a nova versão ativa.
 *
 * A validação de conteúdo acontece DEPOIS do upload físico — é o preço de não
 * poder trafegar 5 MB pelo servidor. Por isso todo caminho de recusa apaga o
 * objeto: um arquivo no bucket sem linha em `document_versions` é lixo que
 * ninguém referencia e ninguém vai limpar depois.
 */
export async function createDocumentVersionAction(
  input: CreateVersionInput,
): Promise<ActionResult<{ id: string; version: number }>> {
  type Created = { id: string; version: number };

  const parsed = createVersionSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<Created>("documents.write");
  if (denied) return denied;

  const { documentId, storagePath, originalFilename, effectiveDate } = parsed.data;

  // O caminho volta pelo cliente, então não é confiável. Confinar à pasta da
  // própria normativa impede que uma versão aponte para o arquivo de outra.
  if (!storagePath.startsWith(`${documentId}/`)) return fail("invalidInput");

  const supabase = await createClient();

  const { data: blob, error: downloadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .download(storagePath);

  if (downloadError || !blob) {
    console.error(`[documents] download para validação falhou: ${downloadError?.message}`);
    return fail("notFound");
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());

  // O tamanho conferido é o dos BYTES QUE CHEGARAM, não o que o cliente disse
  // ter enviado. O bucket já impõe o mesmo teto; esta é a checagem que não
  // depende de nenhum limite estar configurado corretamente lá.
  if (bytes.byteLength > MAX_FILE_SIZE_BYTES) {
    await discardOrphan(storagePath);
    return fail("fileTooLarge");
  }

  const issue = await inspectPdf(bytes);
  if (issue) {
    await discardOrphan(storagePath);
    return fail(issue);
  }

  const { data, error } = await supabase.rpc("create_document_version", {
    p_document_id: documentId,
    p_storage_path: storagePath,
    p_original_filename: originalFilename,
    p_file_size_bytes: bytes.byteLength,
    p_effective_date: effectiveDate,
  } as never);

  if (error || !data) {
    console.error(`[documents] criação da versão falhou: ${error?.message ?? "sem dados"}`);
    await discardOrphan(storagePath);
    return error ? { ok: false, error: mapPostgresError(error) } : fail("unexpected");
  }

  const created = data as VersionRpcResult;
  revalidateDocuments();
  return ok({ id: created.id, version: created.version });
}

/**
 * Tira do bucket um arquivo que foi recusado.
 *
 * Best-effort: se a remoção falhar, o upload continua recusado — o que não pode
 * acontecer é um arquivo inválido virar normativa porque a limpeza deu errado.
 */
async function discardOrphan(storagePath: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);

  if (error) {
    console.error(`[documents] arquivo órfão não removido (${storagePath}): ${error.message}`);
  }
}

/**
 * Ativar/reativar ou inativar uma versão.
 *
 * As duas operações são funções no banco porque cada uma mexe em duas linhas
 * mais a auditoria, e um estado intermediário com duas versões ativas não pode
 * existir nem por um instante. O índice único parcial é a garantia final.
 */
export async function setVersionStatusAction(
  input: VersionCommandInput,
): Promise<ActionResult<{ id: string; version: number }>> {
  type Changed = { id: string; version: number };

  const parsed = versionCommandSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<Changed>("documents.write");
  if (denied) return denied;

  const supabase = await createClient();
  const args = { p_version_id: parsed.data.versionId } as never;

  const { data, error } =
    parsed.data.command === "activate"
      ? await supabase.rpc("activate_document_version", args)
      : await supabase.rpc("deactivate_document_version", args);

  if (error || !data) {
    console.error(`[documents] ${parsed.data.command} falhou: ${error?.message ?? "sem dados"}`);
    return error ? { ok: false, error: mapPostgresError(error) } : fail("unexpected");
  }

  const changed = data as VersionRpcResult;
  revalidateDocuments();
  return ok({ id: changed.id, version: changed.version });
}
