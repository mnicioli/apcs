import "server-only";
import { createClient } from "@/lib/supabase/server";
import { inspectImage } from "@/lib/files/image";
import { EVENTS_BUCKET } from "./storage";

/**
 * O QUE ACONTECE DEPOIS QUE UM ARQUIVO SOBE AO BUCKET `events`.
 *
 * ⚠️ ESTE ARQUIVO NASCEU DE UMA EXTRAÇÃO, NÃO DE UMA CÓPIA. As três funções
 * abaixo eram privadas de `src/lib/actions/events.ts`. Quando a Landing Page
 * passou a ter imagem própria (§8 do Prompt 2), copiá-las seria criar uma
 * segunda versão da regra "o que conta como imagem válida" — e a segunda ficaria
 * para trás no dia em que a primeira mudasse.
 *
 * Elas moram aqui, e não naquele arquivo, por uma razão mecânica: um módulo
 * `"use server"` só pode exportar funções assíncronas que sejam Server Actions.
 * Estas são helpers de servidor, não actions.
 *
 * ⚠️ POR QUE A VALIDAÇÃO ACONTECE DEPOIS DO UPLOAD. A Vercel corta o corpo de
 * requisições serverless em 4,5 MB e o limite do módulo é 5 MB: uma imagem
 * grande simplesmente não chega por Server Action. O arquivo vai direto ao
 * Storage com uma URL assinada, e só então o servidor baixa os bytes e olha.
 * Por isso todo caminho de recusa APAGA o objeto — um arquivo no bucket sem
 * linha que o referencie é lixo que ninguém vai limpar depois.
 */

/** O que a inspeção pode recusar. Cada um vira uma mensagem própria na tela. */
export type UploadedImageIssue = "fileNotImage" | "fileTooLarge" | "notFound";

/**
 * Baixa o que subiu e examina os BYTES.
 *
 * O tamanho conferido é o dos bytes QUE CHEGARAM, não o que o cliente disse ter
 * enviado. O bucket já impõe o mesmo teto; esta é a checagem que não depende de
 * nenhum limite estar configurado corretamente lá.
 *
 * A extensão conferida é a do CAMINHO NO BUCKET, que o servidor montou a partir
 * da allowlist — não o nome que a pessoa enviou, que já não existe neste ponto.
 */
export async function inspectUploadedImage(
  storagePath: string,
): Promise<{ mime: string; sizeBytes: number } | { issue: UploadedImageIssue }> {
  const supabase = await createClient();

  const { data: blob, error } = await supabase.storage.from(EVENTS_BUCKET).download(storagePath);

  if (error || !blob) {
    console.error(`[events] download para validação falhou: ${error?.message ?? "sem dados"}`);
    return { issue: "notFound" };
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());

  const inspection = inspectImage(bytes, storagePath);
  if (!inspection.ok) return { issue: inspection.issue };

  return { mime: inspection.mime, sizeBytes: bytes.byteLength };
}

/**
 * Tira do bucket um arquivo que foi recusado.
 *
 * Best-effort: se a remoção falhar, o upload continua recusado — o que não pode
 * acontecer é um arquivo inválido virar o cartaz de um evento porque a limpeza
 * deu errado.
 */
export async function discardOrphan(storagePath: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.storage.from(EVENTS_BUCKET).remove([storagePath]);

  if (error) {
    console.error(`[events] arquivo órfão não removido (${storagePath}): ${error.message}`);
  }
}

/**
 * Descarta a imagem ANTIGA depois de uma substituição — e só se for seguro.
 *
 * "Seguro" tem uma definição precisa: nenhuma linha aponta mais para aquele
 * caminho. A conferência não é zelo excessivo — duas edições simultâneas são
 * serializadas pelo lock consultivo, mas a segunda pode ter reposto um caminho
 * que a primeira ia apagar. Perguntar ao banco antes troca "apagar a imagem
 * viva de um evento" por "deixar um órfão", que é o lado certo da troca.
 *
 * ⚠️ A TABELA É PARÂMETRO porque o mesmo bucket guarda duas coisas: o cartaz do
 * evento (`events.image_path`) e a arte da página de inscrição
 * (`event_landing_pages.image_path`). Perguntar à tabela errada devolveria "não
 * está mais em uso" sobre um arquivo que está — e apagaria a imagem viva.
 */
export async function discardReplacedImage(
  storagePath: string,
  table: "events" | "event_landing_pages",
): Promise<void> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("image_path", storagePath)
    .returns<{ id: string }[]>()
    .maybeSingle();

  if (error) {
    console.error(`[events] checagem antes de apagar imagem falhou: ${error.message}`);
    return;
  }
  if (data) return; // ainda referenciada — não apaga

  await discardOrphan(storagePath);
}
