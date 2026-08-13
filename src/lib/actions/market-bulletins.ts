"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertPermission } from "@/lib/auth/assert-permission";
import { fail, mapPostgresError, ok, type ActionResult } from "@/lib/actions/errors";
import {
  imageExtensionOf,
  inspectImage,
  MAX_IMAGE_SIZE_BYTES,
  validateImageCandidate,
} from "@/lib/files/image";
import { inspectPdf, MAX_PDF_SIZE_BYTES, validatePdfCandidate } from "@/lib/files/pdf";
import {
  buildFilePath,
  IMAGE_SIGNED_URL_TTL_SECONDS,
  MARKET_BUCKET,
  PDF_SIGNED_URL_TTL_SECONDS,
} from "@/lib/market/storage";
import { MARKET_ROUTE_PATTERNS } from "@/modules/market/market.routes";
import { downloadFilename } from "@/modules/market/market.rules";
import {
  bulletinFormSchema,
  createVersionSchema,
  fileUrlSchema,
  updateBulletinSchema,
  uploadTicketSchema,
  versionCommandSchema,
  type BulletinFormData,
  type CreateVersionInput,
  type FileUrlInput,
  type UpdateBulletinInput,
  type UploadTicketInput,
  type VersionCommandInput,
} from "@/modules/market/market.schema";

/**
 * ACTION = escrita. SEMPRE retorna `ActionResult<T>`, NUNCA lança.
 *
 * Ordem obrigatória: validar → autorizar → escrever → mapear erro → revalidar.
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 *
 * O QUE FICA NO BANCO, E POR QUÊ: publicar uma versão são quatro escritas que
 * precisam acontecer juntas (inativar a atual, criar a nova já ativa, carimbar o
 * nome funcional sem colidir e auditar). O supabase-js não faz transação de
 * várias chamadas, então isso é uma função Postgres. Aqui em cima ficam só a
 * autorização e a validação dos ARQUIVOS — que é o que o banco não tem como
 * fazer.
 */

/**
 * O que as funções transacionais devolvem.
 *
 * O tipo precisa ser afirmado na mão porque o `as never` nos argumentos —
 * contorno do descompasso de generics ssr/supabase-js, o mesmo de insert/update
 * (ver CONVENTIONS.md) — colapsa também o tipo do retorno.
 */
interface VersionRpcResult {
  id: string;
  bulletin_id: string;
  version: number;
  version_name: string;
}

interface BulletinRpcResult {
  id: string;
  name: string;
}

function revalidateMarket(): void {
  for (const pattern of MARKET_ROUTE_PATTERNS) revalidatePath(pattern, "page");
}

// ----------------------------------------------------------------------------
// Leitura de arquivo — exige `market.read` (Administrador, Gestor e Atendente)
// ----------------------------------------------------------------------------

/**
 * URL temporária para ver ou baixar a imagem ou o PDF de uma publicação.
 *
 * É `market.read` e não `market.write` de propósito: quem atende precisa
 * consultar e baixar o boletim vigente sem poder publicar nada.
 *
 * O cliente manda o `versionId`; o caminho no bucket é resolvido aqui. O
 * navegador nunca vê onde o arquivo mora, e a RLS de `market_bulletin_versions`
 * é o que decide se essa linha existe para quem está pedindo.
 */
export async function getBulletinFileUrlAction(
  input: FileUrlInput,
): Promise<ActionResult<{ url: string }>> {
  const parsed = fileUrlSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<{ url: string }>("market.read");
  if (denied) return denied;

  const supabase = await createClient();

  const { data: version, error: readError } = await supabase
    .from("market_bulletin_versions")
    .select(
      "id, bulletin_id, version_name, image_path, pdf_path, " +
        "bulletin:market_bulletins!inner (name)",
    )
    .eq("id", parsed.data.versionId)
    .returns<
      {
        id: string;
        bulletin_id: string;
        version_name: string;
        image_path: string;
        pdf_path: string;
        bulletin: { name: string };
      }[]
    >()
    .maybeSingle();

  if (readError) {
    console.error(`[market] leitura da publicação falhou: ${readError.message}`);
    return { ok: false, error: mapPostgresError(readError) };
  }
  if (!version) return fail("notFound");

  const isPdf = parsed.data.kind === "pdf";
  const path = isPdf ? version.pdf_path : version.image_path;
  const ttl = isPdf ? PDF_SIGNED_URL_TTL_SECONDS : IMAGE_SIGNED_URL_TTL_SECONDS;

  // O nome que chega ao computador de quem baixa é MONTADO, não o que a pessoa
  // enviou: "bolsa-final-v2.pdf" na pasta de Downloads três semanas depois não
  // diz de que Bolsa nem de que data ele é. A extensão sai do CAMINHO, que o
  // servidor escolheu — nunca do nome original, que veio de fora.
  const extension = (isPdf ? ".pdf" : imageExtensionOf(path)) ?? ".jpg";
  const filename = downloadFilename(version.bulletin.name, version.version_name, extension);

  const { data, error } = await supabase.storage.from(MARKET_BUCKET).createSignedUrl(
    path,
    ttl,
    // Com `download`, o Storage devolve `Content-Disposition: attachment` e o
    // arquivo chega com o nome original — que é o único lugar onde ele importa.
    // Sem a opção, o navegador abre o arquivo na tela.
    parsed.data.mode === "download" ? { download: filename } : undefined,
  );

  if (error || !data) {
    console.error(`[market] URL assinada falhou: ${error?.message ?? "sem dados"}`);
    return fail("unexpected");
  }

  await recordAccess(version.bulletin_id, version.id, version.version_name, parsed.data);

  return ok({ url: data.signedUrl });
}

/**
 * Registra na trilha que alguém abriu ou baixou um arquivo.
 *
 * LIMITE HONESTO: o que fica registrado é a EMISSÃO da URL, não cada leitura.
 * Quem guardar o link consegue reabri-lo dentro da validade sem gerar novo
 * evento — é o TTL curto que limita essa janela, não a auditoria.
 *
 * Falha aqui não derruba o acesso: negar a leitura do boletim vigente porque o
 * log não gravou seria trocar um problema pequeno por um grande. O erro vai
 * para o servidor, onde alguém pode agir sobre ele.
 */
async function recordAccess(
  bulletinId: string,
  versionId: string,
  versionName: string,
  input: FileUrlInput,
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from("market_bulletin_audit_logs").insert({
    bulletin_id: bulletinId,
    version_id: versionId,
    action: input.mode === "download" ? "version_downloaded" : "version_viewed",
    metadata: { version_name: versionName, file: input.kind },
  } as never);

  if (error) {
    console.error(`[market] auditoria de ${input.mode} não registrada: ${error.message}`);
  }
}

// ----------------------------------------------------------------------------
// Escrita — exige `market.write` (Administrador e Gestor)
// ----------------------------------------------------------------------------

/** Cadastra uma Bolsa. Ela nasce sem publicação, esperando a primeira. */
export async function createBulletinAction(
  input: BulletinFormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = bulletinFormSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<{ id: string }>("market.write");
  if (denied) return denied;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_market_bulletin", {
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? null,
    p_chatbot_enabled: parsed.data.chatbotEnabled,
  } as never);

  if (error || !data) {
    console.error(`[market] cadastro de Bolsa falhou: ${error?.message ?? "sem dados"}`);
    return error ? { ok: false, error: mapPostgresError(error) } : fail("unexpected");
  }

  revalidateMarket();
  return ok({ id: (data as BulletinRpcResult).id });
}

/** Edita o cadastro. A trilha guarda o antes e o depois de cada campo alterado. */
export async function updateBulletinAction(
  input: UpdateBulletinInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = updateBulletinSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<{ id: string }>("market.write");
  if (denied) return denied;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("update_market_bulletin", {
    p_bulletin_id: parsed.data.bulletinId,
    p_name: parsed.data.name,
    p_description: parsed.data.description ?? null,
    p_chatbot_enabled: parsed.data.chatbotEnabled,
  } as never);

  if (error || !data) {
    console.error(`[market] edição de Bolsa falhou: ${error?.message ?? "sem dados"}`);
    return error ? { ok: false, error: mapPostgresError(error) } : fail("unexpected");
  }

  revalidateMarket();
  return ok({ id: (data as BulletinRpcResult).id });
}

/**
 * Passo 1 do upload: autoriza e devolve um endereço para o navegador enviar o
 * arquivo DIRETO ao Supabase Storage.
 *
 * O arquivo não passa pelo servidor Next por um motivo concreto: a Vercel corta
 * o corpo de qualquer requisição serverless em 4,5 MB, e o limite do módulo é
 * 5 MB. Não é questão de configuração — um PDF de 5 MB simplesmente não chega
 * por Server Action. O que trafega aqui são algumas centenas de bytes.
 *
 * A tela chama isto DUAS VEZES, uma por arquivo, com o mesmo `versionId` — é o
 * que põe imagem e PDF na pasta da mesma publicação.
 */
export async function requestBulletinUploadAction(
  input: UploadTicketInput,
): Promise<ActionResult<{ bucket: string; path: string; token: string }>> {
  type Ticket = { bucket: string; path: string; token: string };

  const parsed = uploadTicketSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<Ticket>("market.write");
  if (denied) return denied;

  const { bulletinId, versionId, kind, filename, sizeBytes } = parsed.data;

  // `type: ""` porque o servidor não vê o MIME que o navegador declarou — aqui
  // só dá para conferir extensão e tamanho. O que o arquivo REALMENTE é fica
  // para o passo 2, depois de ele existir.
  const candidate = { name: filename, size: sizeBytes, type: "" };
  const issue =
    kind === "pdf" ? validatePdfCandidate(candidate) : validateImageCandidate(candidate);
  if (issue) return fail(issue);

  const supabase = await createClient();

  // Confere que a Bolsa existe ANTES de emitir o endereço: sem isto, o arquivo
  // subiria para uma pasta órfã e só descobriríamos no passo 2.
  const { data: bulletin, error: readError } = await supabase
    .from("market_bulletins")
    .select("id")
    .eq("id", bulletinId)
    .returns<{ id: string }[]>()
    .maybeSingle();

  if (readError) {
    console.error(`[market] leitura da Bolsa falhou: ${readError.message}`);
    return { ok: false, error: mapPostgresError(readError) };
  }
  if (!bulletin) return fail("notFound");

  const path = buildFilePath(bulletinId, versionId, kind, filename);
  const { data, error } = await supabase.storage.from(MARKET_BUCKET).createSignedUploadUrl(path);

  if (error || !data) {
    console.error(`[market] URL de upload falhou: ${error?.message ?? "sem dados"}`);
    return fail("unexpected");
  }

  return ok({ bucket: MARKET_BUCKET, path: data.path, token: data.token });
}

/**
 * Passo 2: os DOIS arquivos já estão no bucket. Agora eles são examinados de
 * verdade e, se passarem, viram a nova publicação ativa.
 *
 * ⚠️ O PAR É INDIVISÍVEL. Se qualquer um dos dois for reprovado, NENHUM entra —
 * e os dois objetos saem do bucket. Uma publicação com o PDF de agosto e a
 * imagem de julho é o erro que este módulo existe para tornar impossível.
 *
 * A validação de conteúdo acontece DEPOIS do upload físico — é o preço de não
 * poder trafegar 5 MB pelo servidor. Por isso todo caminho de recusa apaga os
 * objetos: arquivo no bucket sem linha em `market_bulletin_versions` é lixo que
 * ninguém referencia e ninguém vai limpar depois.
 */
export async function createBulletinVersionAction(
  input: CreateVersionInput,
): Promise<ActionResult<{ id: string; versionName: string }>> {
  type Created = { id: string; versionName: string };

  const parsed = createVersionSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<Created>("market.write");
  if (denied) return denied;

  const { bulletinId, versionId, effectiveDate, imagePath, imageFilename, pdfPath, pdfFilename } =
    parsed.data;

  // Os caminhos voltam pelo cliente, então não são confiáveis. Confinar à pasta
  // da própria publicação impede que uma versão aponte para o arquivo de outra.
  // O banco confere o mesmo nos CHECKs de escopo — esta é a barreira que dá a
  // mensagem certa antes de chegar lá.
  const folder = `${bulletinId}/${versionId}/`;
  if (!imagePath.startsWith(`${folder}image/`) || !pdfPath.startsWith(`${folder}pdf/`)) {
    return fail("invalidInput");
  }

  const uploaded = [imagePath, pdfPath];

  const image = await readAndCheckImage(imagePath, imageFilename);
  if (!image.ok) {
    await discardOrphans(uploaded);
    return fail(image.issue);
  }

  const pdf = await readAndCheckPdf(pdfPath);
  if (!pdf.ok) {
    await discardOrphans(uploaded);
    return fail(pdf.issue);
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_market_bulletin_version", {
    p_version_id: versionId,
    p_bulletin_id: bulletinId,
    p_effective_date: effectiveDate,
    p_image_path: imagePath,
    p_image_filename: imageFilename,
    p_image_mime_type: image.mime,
    p_image_size_bytes: image.sizeBytes,
    p_pdf_path: pdfPath,
    p_pdf_filename: pdfFilename,
    p_pdf_size_bytes: pdf.sizeBytes,
  } as never);

  if (error || !data) {
    console.error(`[market] publicação falhou: ${error?.message ?? "sem dados"}`);
    await discardOrphans(uploaded);
    return error ? { ok: false, error: mapPostgresError(error) } : fail("unexpected");
  }

  const created = data as VersionRpcResult;
  revalidateMarket();
  return ok({ id: created.id, versionName: created.version_name });
}

type FileCheck<T> =
  | ({ ok: true } & T)
  | {
      ok: false;
      issue: "fileNotImage" | "fileTooLarge" | "fileNotPdf" | "fileEncrypted" | "notFound";
    };

/**
 * Baixa a imagem do bucket e prova, nos BYTES, que ela é o que diz ser.
 *
 * O tamanho conferido é o dos BYTES QUE CHEGARAM, não o que o cliente disse ter
 * enviado. O bucket já impõe o mesmo teto; esta é a checagem que não depende de
 * nenhum limite estar configurado corretamente lá.
 */
async function readAndCheckImage(
  path: string,
  filename: string,
): Promise<FileCheck<{ mime: string; sizeBytes: number }>> {
  const bytes = await downloadBytes(path);
  if (!bytes) return { ok: false, issue: "notFound" };

  if (bytes.byteLength > MAX_IMAGE_SIZE_BYTES) return { ok: false, issue: "fileTooLarge" };

  const inspection = inspectImage(bytes, filename);
  if (!inspection.ok) return { ok: false, issue: inspection.issue };

  return { ok: true, mime: inspection.mime, sizeBytes: bytes.byteLength };
}

/** O mesmo para o PDF — incluindo a recusa de arquivo protegido por senha. */
async function readAndCheckPdf(path: string): Promise<FileCheck<{ sizeBytes: number }>> {
  const bytes = await downloadBytes(path);
  if (!bytes) return { ok: false, issue: "notFound" };

  if (bytes.byteLength > MAX_PDF_SIZE_BYTES) return { ok: false, issue: "fileTooLarge" };

  const issue = await inspectPdf(bytes);
  if (issue) return { ok: false, issue };

  return { ok: true, sizeBytes: bytes.byteLength };
}

async function downloadBytes(path: string): Promise<Uint8Array | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(MARKET_BUCKET).download(path);

  if (error || !data) {
    console.error(`[market] download para validação falhou (${path}): ${error?.message}`);
    return null;
  }

  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Tira do bucket os arquivos de uma publicação recusada.
 *
 * Best-effort: se a remoção falhar, o upload continua recusado — o que não pode
 * acontecer é um arquivo inválido virar boletim porque a limpeza deu errado.
 * Os DOIS saem juntos, mesmo que só um tenha sido reprovado: metade de uma
 * publicação no bucket não serve para nada e ninguém a coletaria depois.
 */
async function discardOrphans(paths: string[]): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.storage.from(MARKET_BUCKET).remove(paths);

  if (error) {
    console.error(`[market] arquivos órfãos não removidos (${paths.join(", ")}): ${error.message}`);
  }
}

/**
 * Ativar/reativar ou inativar uma publicação.
 *
 * As duas operações são funções no banco porque cada uma mexe em duas linhas
 * mais a auditoria, e um estado intermediário com duas publicações ativas não
 * pode existir nem por um instante. O índice único parcial é a garantia final.
 *
 * ⚠️ `deactivate` na publicação ATIVA é sempre recusado (MB001): a Bolsa não
 * pode ficar sem uma. Para trocar a oficial, use `activate` na desejada — ela
 * inativa a anterior na mesma transação.
 */
export async function setVersionStatusAction(
  input: VersionCommandInput,
): Promise<ActionResult<{ id: string; versionName: string }>> {
  type Changed = { id: string; versionName: string };

  const parsed = versionCommandSchema.safeParse(input);
  if (!parsed.success) return fail("invalidInput");

  const denied = await assertPermission<Changed>("market.write");
  if (denied) return denied;

  const supabase = await createClient();
  const args = {
    p_version_id: parsed.data.versionId,
    p_bulletin_id: parsed.data.bulletinId,
  } as never;

  const { data, error } =
    parsed.data.command === "activate"
      ? await supabase.rpc("activate_market_bulletin_version", args)
      : await supabase.rpc("deactivate_market_bulletin_version", args);

  if (error || !data) {
    console.error(`[market] ${parsed.data.command} falhou: ${error?.message ?? "sem dados"}`);
    return error ? { ok: false, error: mapPostgresError(error) } : fail("unexpected");
  }

  const changed = data as VersionRpcResult;
  revalidateMarket();
  return ok({ id: changed.id, versionName: changed.version_name });
}
