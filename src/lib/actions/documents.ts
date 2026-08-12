"use server";

import { createClient } from "@/lib/supabase/server";
import { assertPermission } from "@/lib/auth/assert-permission";
import { fail, mapPostgresError, ok, type ActionResult } from "@/lib/actions/errors";
import { DOCUMENTS_BUCKET, SIGNED_URL_TTL_SECONDS } from "@/lib/documents/storage";
import { versionUrlSchema, type VersionUrlInput } from "@/modules/document/document.schema";

/**
 * ACTION = escrita. SEMPRE retorna `ActionResult<T>`, NUNCA lança.
 *
 * Ordem obrigatória: validar → autorizar → escrever → mapear erro → revalidar.
 * Ver docs/SERVICE-ACTION-PATTERN.md.
 */

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
