"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Uma imagem que mora em bucket privado e chega por URL ASSINADA.
 *
 * Vive no design system porque Eventos (o cartaz) e Bolsa (a imagem do boletim)
 * têm exatamente o mesmo problema: a URL expira, o objeto pode ter sumido, e a
 * grid não pode virar uma parede de ícones de imagem quebrada.
 *
 * ⚠️ `<img>` e não `next/image`, de propósito. A URL é assinada e de vida curta:
 * o otimizador do Next teria de buscá-la de novo a cada renderização (a URL
 * muda), o cache dele nunca acertaria, e o servidor Next passaria a proxiar
 * arquivos de até 5 MB que hoje vão direto do Storage para o navegador.
 *
 * `loading="lazy"` é o que segura o custo da grid: as linhas abaixo da dobra só
 * baixam a imagem quando alguém rola até elas.
 */
export function SignedImage({
  url,
  alt,
  className,
  sizes = "h-10 w-16",
}: {
  url: string | null;
  /** Descreve A COISA, não o arquivo — é o que um leitor de tela precisa ouvir. */
  alt: string;
  className?: string;
  sizes?: string;
}) {
  // A URL pode expirar ou o objeto pode ter sumido. Nos dois casos a linha
  // continua legível: o que não pode é a imagem quebrada do navegador aparecer
  // no meio da tabela.
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
