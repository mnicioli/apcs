import Image from "next/image";
import { LANDING_INSTITUTIONAL_CONTEXT } from "@/modules/event/event.landing.labels";
import { cn } from "@/lib/utils";

/**
 * A MARCA DO CSPI — o desenho oficial, ao lado do da APCS.
 *
 * ⚠️ ELA SUBSTITUI UM SUBSTITUTO TIPOGRÁFICO, e vale registrar por quê. Até
 * aqui o CSPI aparecia como a PALAVRA "CSPI" em versalete, com este comentário
 * na Landing Page e na prévia do Builder: "o arquivo não existe; desenhar um
 * substituto seria inventar a marca de terceiro". Era a decisão certa naquele
 * momento — e a única coisa que faltava para desfazê-la era o arquivo. Ele
 * chegou (`public/logo-cspi.png`), e os dois lugares passaram a ler daqui.
 *
 * Mesmo motivo do `ApcsMark` para viver em `src/components/`: duas cópias do
 * mesmo desenho é como marca se desalinha — alguém ajusta a altura de uma e a
 * outra fica para trás por meses sem ninguém notar.
 */
export const CSPI_LOGO_SRC = "/logo-cspi.png";

/**
 * Proporção do arquivo (924 × 258), para o Next reservar o espaço certo e a
 * página não pular quando a imagem chega.
 *
 * ⚠️ O DESENHO É MUITO MAIS LARGO QUE ALTO — 3,58 contra 1,83 do da APCS. Quem
 * pedir as duas marcas com a MESMA altura recebe uma quase o dobro da largura
 * da outra, que é o comportamento certo: altura igual é o que faz duas marcas
 * parecerem do mesmo tamanho, não largura igual.
 */
const RATIO = 924 / 258;

export function CspiMark({ className, height = 26 }: { className?: string; height?: number }) {
  return (
    <Image
      src={CSPI_LOGO_SRC}
      alt={LANDING_INSTITUTIONAL_CONTEXT.program}
      width={Math.round(height * RATIO)}
      height={height}
      style={{ height, width: "auto" }}
      priority
      className={cn("object-contain", className)}
    />
  );
}
