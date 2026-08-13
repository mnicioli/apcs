"use client";

import { useId, useState, useTransition } from "react";
import { FileText, ImageUp, Upload } from "lucide-react";
import {
  createBulletinVersionAction,
  requestBulletinUploadAction,
} from "@/lib/actions/market-bulletins";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { formatCalendarDate, formatFileSize } from "@/lib/utils";
import { buildVersionName } from "@/modules/market/market.rules";
import {
  effectiveDateSchema,
  IMAGE_ACCEPT_ATTRIBUTE,
  PDF_EXTENSION,
  validateImageCandidate,
  validatePdfCandidate,
  type BulletinFileKind,
} from "@/modules/market/market.schema";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SignedImage } from "@/components/ui/signed-image";
import { FileDropZone } from "./file-drop-zone";

const IMAGEM_AUSENTE = "A imagem é obrigatória.";
const PDF_AUSENTE = "O PDF é obrigatório.";
const DATA_AUSENTE = "Informe a data de vigência.";

/** O que a tela está fazendo agora, para quem está esperando saber. */
type Progresso = null | "image" | "pdf" | "saving";

const PROGRESSO_TEXTO: Record<Exclude<Progresso, null>, string> = {
  image: "Enviando a imagem...",
  pdf: "Enviando o PDF...",
  saving: "Publicando...",
};

/**
 * Publicação de uma nova versão da Bolsa, em dois passos.
 *
 * O segundo passo existe por causa do efeito colateral: publicar troca o
 * boletim que a APCS apresenta e que o chatbot cita. Quem clica precisa ver
 * isso escrito antes de confirmar, não descobrir depois.
 *
 * OS ARQUIVOS NÃO PASSAM PELO SERVIDOR NEXT. A Vercel corta o corpo de
 * requisições serverless em 4,5 MB e o limite aqui é 5 MB POR ARQUIVO, então o
 * navegador envia direto ao Supabase Storage com endereços assinados de uso
 * único. O servidor só autoriza antes e valida depois — lendo os bytes.
 *
 * ⚠️ O `versionId` é sorteado AQUI, antes de existir linha no banco, porque os
 * dois arquivos precisam ir para a pasta da mesma publicação. Um id que nunca
 * chega à confirmação não vira nada: deixa arquivo órfão, que a própria action
 * apaga.
 */
export function PublishVersionDialog({
  bulletinId,
  bulletinName,
  currentVersionName,
  today,
  trigger = "button",
}: {
  bulletinId: string;
  bulletinName: string;
  /** A publicação ativa hoje, para o aviso de substituição. `null` na primeira. */
  currentVersionName: string | null;
  /** "Hoje" no fuso da APCS, para prever o nome da publicação. */
  today: string;
  trigger?: "button" | "menu";
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [image, setImage] = useState<File | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<Progresso>(null);
  const [isPending, startTransition] = useTransition();
  // A grid monta um destes por linha: um id fixo faria todos os `<Label>` da
  // página apontarem para o campo de data da primeira Bolsa.
  const dateId = useId();

  function reset() {
    setStep("pick");
    setImage(null);
    setPdf(null);
    setEffectiveDate("");
    setError(null);
    setProgresso(null);
  }

  function close() {
    if (isPending) return;
    setOpen(false);
    reset();
  }

  function goToConfirm() {
    // A ordem das checagens segue a ordem dos campos na tela: a primeira coisa
    // que falta é a primeira coisa que a pessoa lê.
    if (!image) return setError(IMAGEM_AUSENTE);
    if (!pdf) return setError(PDF_AUSENTE);
    if (!effectiveDateSchema.safeParse(effectiveDate).success) return setError(DATA_AUSENTE);

    setError(null);
    setStep("confirm");
  }

  /** Sobe um arquivo e devolve o caminho no bucket, ou `null` se falhar. */
  async function upload(
    versionId: string,
    kind: BulletinFileKind,
    file: File,
  ): Promise<string | null> {
    const ticket = await requestBulletinUploadAction({
      bulletinId,
      versionId,
      kind,
      filename: file.name,
      sizeBytes: file.size,
    });

    if (!ticket.ok) {
      setError(ACTION_ERROR_MESSAGES[ticket.error.code]);
      return null;
    }

    // Import dinâmico de propósito: o supabase-js no navegador acrescentaria
    // ~90 kB à página inteira — inclusive para quem só entra para consultar o
    // boletim. Assim o pacote só desce quando alguém publica.
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();

    const { error: uploadError } = await supabase.storage
      .from(ticket.data.bucket)
      .uploadToSignedUrl(ticket.data.path, ticket.data.token, file);

    if (uploadError) {
      console.error(`[market] envio ao storage falhou (${kind}): ${uploadError.message}`);
      setError("Não foi possível realizar o upload. Tente novamente.");
      return null;
    }

    return ticket.data.path;
  }

  function submit() {
    if (!image || !pdf) return;
    setError(null);

    startTransition(async () => {
      const versionId = crypto.randomUUID();

      setProgresso("image");
      const imagePath = await upload(versionId, "image", image);
      if (!imagePath) return falhou();

      setProgresso("pdf");
      const pdfPath = await upload(versionId, "pdf", pdf);
      if (!pdfPath) return falhou();

      // O servidor agora baixa os DOIS e examina de verdade: se o PDF tiver
      // senha ou a imagem for um arquivo renomeado, ele recusa e apaga os dois.
      setProgresso("saving");
      const created = await createBulletinVersionAction({
        bulletinId,
        versionId,
        effectiveDate,
        imagePath,
        imageFilename: image.name,
        pdfPath,
        pdfFilename: pdf.name,
      });

      if (!created.ok) {
        setError(ACTION_ERROR_MESSAGES[created.error.code]);
        return falhou();
      }

      setOpen(false);
      reset();
    });
  }

  /** Volta para a escolha com a mensagem já na tela. */
  function falhou() {
    setProgresso(null);
    setStep("pick");
  }

  const nomePrevisto = buildVersionName(today);

  return (
    <>
      <Button
        variant={trigger === "button" ? "default" : "ghost"}
        size={trigger === "button" ? "default" : "sm"}
        onClick={() => setOpen(true)}
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        Nova versão
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="Nova versão"
        description={bulletinName}
        className="w-[min(92vw,42rem)]"
      >
        {step === "pick" ? (
          <div className="space-y-5">
            <FileDropZone
              label="Imagem"
              file={image}
              onFileChange={setImage}
              accept={IMAGE_ACCEPT_ATTRIBUTE}
              hint="Formatos: JPG, JPEG, PNG e WEBP · Tamanho máximo: 5 MB"
              icon={
                <ImageUp className="text-muted-foreground mx-auto h-8 w-8" aria-hidden="true" />
              }
              disabled={isPending}
              validate={(file) => {
                const issue = validateImageCandidate(file);
                return issue ? ACTION_ERROR_MESSAGES[issue] : null;
              }}
              preview={(url) => (
                <SignedImage url={url} alt="Imagem escolhida para a Bolsa" sizes="h-24 w-40" />
              )}
            />

            <FileDropZone
              label="PDF"
              file={pdf}
              onFileChange={setPdf}
              accept={`application/pdf,${PDF_EXTENSION}`}
              hint="Formato: PDF · Tamanho máximo: 5 MB"
              icon={
                <FileText className="text-muted-foreground mx-auto h-8 w-8" aria-hidden="true" />
              }
              disabled={isPending}
              validate={(file) => {
                const issue = validatePdfCandidate(file);
                return issue ? ACTION_ERROR_MESSAGES[issue] : null;
              }}
            />

            <div className="space-y-2">
              <Label htmlFor={dateId}>Data de vigência</Label>
              <Input
                id={dateId}
                type="date"
                value={effectiveDate}
                disabled={isPending}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Quando o boletim passa a valer. É diferente da data de envio, que o sistema registra
                sozinho — e pode ser hoje, uma data passada ou uma data futura.
              </p>
            </div>

            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button onClick={goToConfirm}>Continuar</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-sm">
              Você está publicando uma nova versão de <strong>{bulletinName}</strong>.{" "}
              {currentVersionName === null ? (
                <>Ela será a primeira e já entrará no ar.</>
              ) : (
                <>
                  A publicação <strong>{currentVersionName}</strong>, ativa hoje, será
                  automaticamente inativada, e a nova passará a ser a oficial.
                </>
              )}
            </p>

            <dl className="bg-muted space-y-1 rounded-md p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Identificação</dt>
                {/* O nome é gerado pelo SISTEMA, a partir da data de hoje. Quem
                    publica não digita e não escolhe — e vê aqui o que vai sair. */}
                <dd className="font-medium">{nomePrevisto ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Imagem</dt>
                <dd className="truncate">
                  {image?.name} ({image ? formatFileSize(image.size) : "—"})
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">PDF</dt>
                <dd className="truncate">
                  {pdf?.name} ({pdf ? formatFileSize(pdf.size) : "—"})
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Vigência</dt>
                <dd>{formatCalendarDate(effectiveDate)}</dd>
              </div>
            </dl>

            {effectiveDate > today && (
              <p role="status" className="text-muted-foreground text-sm">
                A vigência é futura: a publicação entra como oficial agora, mas o chatbot só passa a
                citá-la em {formatCalendarDate(effectiveDate)}.
              </p>
            )}

            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}

            {progresso && (
              <p role="status" className="text-muted-foreground text-sm">
                {PROGRESSO_TEXTO[progresso]}
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("pick")} disabled={isPending}>
                Voltar
              </Button>
              {/* `loading` já desabilita o botão — dois envios do mesmo par
                  gerariam duas publicações idênticas e um número queimado. */}
              <Button onClick={submit} loading={isPending}>
                Publicar
              </Button>
            </DialogFooter>
          </div>
        )}
      </Dialog>
    </>
  );
}
