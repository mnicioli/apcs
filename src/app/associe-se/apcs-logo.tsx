import Image from "next/image";
import { APP_LEGAL_NAME, APP_SHORT_NAME } from "@/config/app";
import { APCS_LOGO_SRC } from "@/components/brand/apcs-logo";

/**
 * A marca da APCS na landing.
 *
 * ⚠️ O DESENHO ESTÁTICO SAIU DAQUI. Ele agora é `@/components/brand/apcs-logo`,
 * porque a mesma assinatura passou a identificar o CRM no alto da navegação —
 * e marca duplicada é marca que desalinha. O que sobrou neste arquivo é o que
 * só a landing tem: a versão ANIMADA, que depende de `landing.css`.
 */
export { ApcsLogo } from "@/components/brand/apcs-logo";
export { APCS_LOGO_SRC } from "@/components/brand/apcs-logo";
export const APCS_SHORT_NAME = APP_SHORT_NAME;
export const APCS_FULL_NAME = APP_LEGAL_NAME;

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
