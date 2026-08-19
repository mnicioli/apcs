import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * A marca da APCS.
 *
 * O layout validado trazia um substituto tipográfico ("APCS" em letra display)
 * para o caso de o logo oficial não existir. Ele existe: `public/logo-apcs.svg`
 * é o logo oficial, em vetor, no vermelho institucional #C4262E — o mesmo que a
 * landing usa como `--primary`. O substituto foi retirado por isso, e não por
 * simplificação: manter um caminho para "sem logo" que nunca roda é manter um
 * caminho que ninguém testa.
 */
export const APCS_LOGO_SRC = "/logo-apcs.svg";
export const APCS_SHORT_NAME = "APCS";
export const APCS_FULL_NAME = "Associação Paulista de Criadores de Suínos";

/** Proporção do arquivo (146 × 80), para o Next reservar o espaço certo. */
const RATIO = 146 / 80;

export function ApcsLogo({ className, height = 36 }: { className?: string; height?: number }) {
  return (
    <span
      className={cn("inline-flex items-center gap-3", className)}
      aria-label={`${APCS_SHORT_NAME} — ${APCS_FULL_NAME}`}
    >
      <Image
        src={APCS_LOGO_SRC}
        alt=""
        width={Math.round(height * RATIO)}
        height={height}
        style={{ height, width: "auto" }}
        priority
      />
      <span aria-hidden className="bg-hairline hidden h-7 w-px sm:block" />
      <span
        aria-hidden
        className="text-muted-foreground hidden max-w-[15rem] text-[11px] leading-tight sm:block"
      >
        Associação Paulista de
        <br />
        Criadores de Suínos
      </span>
    </span>
  );
}

/**
 * A assinatura animada: entrada com halo e um brilho que percorre a marca.
 *
 * ⚠️ Não é Client Component, e não precisa ser: toda a animação está em CSS
 * (landing.css), inclusive o `prefers-reduced-motion`. O brilho usa o PRÓPRIO
 * SVG como máscara, então ele nunca escapa do contorno do desenho.
 */
export function ApcsAnimatedLogo({
  className,
  width = "clamp(170px, 46vw, 260px)",
}: {
  className?: string;
  width?: string;
}) {
  const mascara = {
    WebkitMaskImage: `url(${APCS_LOGO_SRC})`,
    maskImage: `url(${APCS_LOGO_SRC})`,
    WebkitMaskSize: "100% 100%",
    maskSize: "100% 100%",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
  } as const;

  return (
    <div
      className={className}
      style={{ position: "relative", width, aspectRatio: `${146} / ${80}`, display: "block" }}
    >
      <div
        aria-hidden
        className="apcs-mark__halo"
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "190%",
          height: "260%",
          borderRadius: "50%",
          pointerEvents: "none",
        }}
      />

      <Image
        className="apcs-mark__img"
        src={APCS_LOGO_SRC}
        width={146}
        height={80}
        alt={`${APCS_SHORT_NAME}, ${APCS_FULL_NAME}`}
        priority
        style={{
          position: "relative",
          width: "100%",
          height: "auto",
          display: "block",
          willChange: "transform, opacity",
        }}
      />

      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          pointerEvents: "none",
          ...mascara,
        }}
      >
        <div
          className="apcs-mark__shine"
          style={{
            position: "absolute",
            inset: "-20% -40%",
            background:
              "linear-gradient(105deg, transparent 38%, rgba(255,255,255,0.72) 50%, transparent 62%)",
          }}
        />
      </div>
    </div>
  );
}
