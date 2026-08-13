"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * O cartaz do evento, em tamanho de grid ou de detalhe.
 *
 * ⚠️ `<img>` e não `next/image`, de propósito. A URL é ASSINADA e de vida curta:
 * o otimizador do Next teria de buscá-la de novo a cada renderização (a URL
 * muda), o cache dele nunca acertaria, e o servidor Next passaria a proxiar
 * arquivos de até 5 MB que hoje vão direto do Storage para o navegador.
 *
 * `loading="lazy"` é o que segura o custo da grid: as linhas abaixo da dobra só
 * baixam a imagem quando alguém rola até elas.
 */
export function EventThumbnail({
  url,
  alt,
  className,
  sizes = "h-10 w-16",
}: {
  url: string | null;
  /** Descreve o EVENTO, não o arquivo — é o que um leitor de tela precisa ouvir. */
  alt: string;
  className?: string;
  sizes?: string;
}) {
  // A URL pode expirar (1 h) ou o objeto pode ter sumido. Nos dois casos a
  // linha da grid continua legível: o que não pode é a imagem quebrada do
  // navegador aparecer no meio da tabela.
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <div
        role="img"
        aria-label={`Sem imagem disponível para ${alt}`}
        className={cn(
          "bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-md",
          sizes,
          className,
        )}
      >
        <ImageOff className="h-4 w-4" aria-hidden="true" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- ver o comentário do topo
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("bg-muted shrink-0 rounded-md object-cover", sizes, className)}
    />
  );
}
