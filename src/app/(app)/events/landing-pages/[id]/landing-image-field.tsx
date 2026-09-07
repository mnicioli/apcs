"use client";

import { useId, useRef, useState, useTransition, type DragEvent } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import {
  removeLandingPageImageAction,
  requestLandingImageUploadAction,
  setLandingPageImageAction,
} from "@/lib/actions/event-landing";
import { ACTION_ERROR_MESSAGES } from "@/lib/actions/errors";
import { IMAGE_ACCEPT_ATTRIBUTE, validateImageCandidate } from "@/lib/files/image";
import { cn } from "@/lib/utils";
import type { LandingImageSlot } from "@/modules/event/event.landing.schema";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SignedImage } from "@/components/ui/signed-image";

/**
 * AS DUAS ARTES DA PÁGINA DE INSCRIÇÃO — a que abre a página (§8) e o BANNER DE
 * CONFIRMAÇÃO, que substituiu o texto que ficava depois do envio.
 *
 * ⚠️ COMPONENTE PRÓPRIO, E NÃO `EventImageField` REAPROVEITADO — a diferença é
 * de CICLO DE VIDA, não de aparência. Lá o arquivo fica guardado no formulário
 * até alguém salvar o evento, porque na criação o evento ainda não existe. Aqui
 * a página JÁ existe (ela foi criada no passo do §5), então o envio é imediato:
 * escolher a imagem grava. Espremer os dois comportamentos num componente só
 * exigiria um modo, e um modo é onde os dois caminhos param de ser testados
 * juntos.
 *
 * O que É compartilhado está compartilhado: `validateImageCandidate`,
 * `IMAGE_ACCEPT_ATTRIBUTE` e a inspeção dos bytes no servidor
 * (`src/lib/events/image-upload.ts`) são os mesmos de Eventos.
 *
 * ============================================================================
 * ⚠️ UM COMPONENTE PARA AS DUAS ARTES, E UM `slot` PARA DIZER QUAL.
 * ============================================================================
 * A segunda arte chegou depois. Copiar este arquivo para trocar três frases e o
 * destino da gravação teria funcionado no primeiro dia e divergido no segundo:
 * a validação, o arrastar, o foco, o tratamento de erro e a coreografia de
 * substituição são exatamente os mesmos, e é justamente aí que moram as
 * correções que ninguém lembra de aplicar duas vezes.
 *
 * O que muda de verdade cabe em `COPY` e numa prop: o rótulo, o que acontece
 * quando não há imagem, e o que "remover" significa. As actions recebem o mesmo
 * `slot` e resolvem pasta, função Postgres e coluna — ver `IMAGEM_DA_PAGINA` em
 * `src/lib/actions/event-landing.ts`.
 *
 * ⚠️ REMOVER NUNCA DEIXA A PÁGINA SEM NADA, e o motivo é diferente em cada uma.
 * Sem arte própria, a página usa o cartaz do evento — que é obrigatório e
 * sempre existe. Sem banner de confirmação, a tela de confirmação volta ao
 * TEXTO padrão da plataforma. É por isso que "Remover" é uma operação segura
 * aqui e não seria em Eventos, onde a imagem é o único cartaz.
 *
 * ⚠️ A VALIDAÇÃO DAQUI É UX. Quem decide se o arquivo é mesmo uma imagem é o
 * servidor, lendo os bytes: extensão e MIME declarado são texto que veio de
 * fora e mudam com um renomear.
 */

/** O que difere entre as duas artes na TELA. O resto é idêntico. */
const COPY: Record<
  LandingImageSlot,
  {
    label: string;
    /** Explica o que a página faz quando não há arte própria. */
    semArte: string;
    /** O que a arte herdada (quando existe) está fazendo ali. */
    herdada: string;
    /** O rótulo do botão que desfaz o envio. */
    remover: string;
    /** Uma linha embaixo do campo, dizendo onde a arte aparece. */
    ajuda: string;
  }
> = {
  page: {
    label: "Imagem da página",
    semArte: "Arraste a imagem aqui",
    herdada: "Usando o cartaz do evento. Envie um arquivo para usar outra arte só aqui.",
    remover: "Voltar ao cartaz do evento",
    ajuda: "Aparece no topo da página pública, acima do formulário.",
  },
  success: {
    label: "Imagem da confirmação",
    semArte: "Arraste o banner aqui",
    herdada: "",
    remover: "Remover o banner",
    ajuda:
      "Aparece depois de a inscrição ser concluída. Sem banner, a confirmação usa o texto padrão da APCS.",
  },
};

export function LandingImageField({
  landingPageId,
  slot,
  imageUrl,
  fallbackUrl = null,
  eventName,
  disabled = false,
  onSaved,
}: {
  landingPageId: string;
  /** Qual das duas artes este campo controla. */
  slot: LandingImageSlot;
  /** A arte PRÓPRIA deste slot. `null` = não há. */
  imageUrl: string | null;
  /**
   * O que vale quando não há arte própria — hoje, só a arte da página tem isso
   * (o cartaz do evento).
   *
   * ⚠️ O BANNER DE CONFIRMAÇÃO NÃO CAI NO CARTAZ DO EVENTO, de propósito. São
   * duas peças com finalidades diferentes: uma convida, a outra confirma.
   * Mostrar a peça de divulgação como se fosse o comprovante seria pior do que
   * não mostrar imagem nenhuma — e é por isso que ali a ausência leva ao TEXTO,
   * e não a outra imagem.
   */
  fallbackUrl?: string | null;
  eventName: string;
  disabled?: boolean;
  /** Avisa o Builder para reler a página do servidor. */
  onSaved: () => void;
}) {
  const [arrastando, setArrastando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const campoId = useId();

  const copy = COPY[slot];
  const ocupado = disabled || enviando;
  const propria = imageUrl !== null;
  const exibida = imageUrl ?? fallbackUrl;
  const alt = slot === "success" ? `Confirmação de ${eventName}` : `Imagem de ${eventName}`;

  function enviar(candidato: File | undefined) {
    if (!candidato || ocupado) return;

    const problema = validateImageCandidate(candidato);
    if (problema) {
      setErro(ACTION_ERROR_MESSAGES[problema]);
      return;
    }
    setErro(null);

    startTransition(async () => {
      const ticket = await requestLandingImageUploadAction({
        landingPageId,
        slot,
        filename: candidato.name,
        sizeBytes: candidato.size,
      });

      if (!ticket.ok) {
        setErro(ACTION_ERROR_MESSAGES[ticket.error.code]);
        return;
      }

      // Import dinâmico de propósito, como em `event-form.tsx`: o supabase-js no
      // navegador acrescentaria ~90 kB à página, inclusive para quem só abre o
      // Builder para conferir um texto. Assim o pacote só desce quando alguém
      // realmente envia um arquivo.
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      const { error } = await supabase.storage
        .from(ticket.data.bucket)
        .uploadToSignedUrl(ticket.data.path, ticket.data.token, candidato);

      if (error) {
        console.error(`[landing] envio ao storage falhou: ${error.message}`);
        setErro("Não foi possível enviar a imagem. Tente novamente.");
        return;
      }

      const gravado = await setLandingPageImageAction({
        landingPageId,
        slot,
        storagePath: ticket.data.path,
      });

      if (!gravado.ok) {
        setErro(ACTION_ERROR_MESSAGES[gravado.error.code]);
        return;
      }

      if (inputRef.current) inputRef.current.value = "";
      onSaved();
    });
  }

  function remover() {
    if (ocupado) return;
    setErro(null);

    startTransition(async () => {
      const resultado = await removeLandingPageImageAction({ landingPageId, slot });
      if (!resultado.ok) {
        setErro(ACTION_ERROR_MESSAGES[resultado.error.code]);
        return;
      }
      if (inputRef.current) inputRef.current.value = "";
      onSaved();
    });
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={campoId}>{copy.label}</Label>

      <div
        onDragOver={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          if (!ocupado) setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setArrastando(false);
          enviar(event.dataTransfer.files[0]);
        }}
        className={cn(
          "flex flex-col justify-center rounded-lg border-2 border-dashed px-4 py-4 transition-colors",
          arrastando ? "border-primary bg-accent" : "border-border",
        )}
      >
        {exibida ? (
          <div className="space-y-3">
            <SignedImage
              url={exibida}
              alt={alt}
              sizes="w-full"
              className="h-auto max-h-64 bg-transparent object-contain"
            />

            <p className="text-muted-foreground text-center text-xs">
              {propria ? "Arte própria desta página." : copy.herdada}
            </p>

            <div className="flex flex-wrap justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={ocupado}
                onClick={() => inputRef.current?.click()}
              >
                {propria ? "Substituir imagem" : "Usar outra imagem"}
              </Button>
              {propria && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={ocupado}
                  onClick={remover}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {copy.remover}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center">
            <ImageUp className="text-muted-foreground mx-auto h-8 w-8" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">{copy.semArte}</p>
            <p className="text-muted-foreground text-xs">ou</p>
            {/* O botão é a alternativa ao arrastar — quem navega por teclado não
                tem como fazer drag & drop. */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={ocupado}
              onClick={() => inputRef.current?.click()}
            >
              Selecionar arquivo
            </Button>
          </div>
        )}

        <input
          ref={inputRef}
          id={campoId}
          type="file"
          accept={IMAGE_ACCEPT_ATTRIBUTE}
          className="sr-only"
          disabled={ocupado}
          aria-invalid={erro !== null}
          aria-describedby={`${campoId}-ajuda`}
          onChange={(event) => enviar(event.target.files?.[0])}
        />

        <p id={`${campoId}-ajuda`} className="text-muted-foreground mt-4 text-center text-xs">
          Formatos: JPG, JPEG, PNG e WEBP · Tamanho máximo: 5 MB
        </p>
      </div>

      <p className="text-muted-foreground text-xs">{copy.ajuda}</p>

      {enviando && (
        <p role="status" className="text-muted-foreground text-sm">
          Enviando a imagem…
        </p>
      )}

      {erro && (
        <p role="alert" className="text-destructive text-sm">
          {erro}
        </p>
      )}
    </div>
  );
}
