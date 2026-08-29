import Image from "next/image";
import { APP_LEGAL_NAME, APP_SHORT_NAME } from "@/config/app";
import { cn } from "@/lib/utils";

/**
 * A MARCA DA APCS — o logo oficial, e o nome por extenso ao lado dele.
 *
 * Vive em `src/components/` (e não mais só dentro da landing) porque a mesma
 * assinatura passou a identificar o CRM no alto da navegação. Duas cópias do
 * mesmo desenho é como marca se desalinha: alguém ajusta a altura de uma e a
 * outra fica para trás por meses sem ninguém notar.
 *
 * O arquivo é `public/logo-apcs.svg`, vetor, no vermelho institucional #C4262E.
 * Não existe substituto tipográfico: manter um caminho para "sem logo" que
 * nunca roda é manter um caminho que ninguém testa.
 */
export const APCS_LOGO_SRC = "/logo-apcs.svg";

/** Proporção do arquivo (146 × 80), para o Next reservar o espaço certo. */
const RATIO = 146 / 80;

/**
 * Só o desenho, sem o nome — para onde não cabe a assinatura inteira (o
 * cabeçalho do celular, por exemplo, onde a lateral está escondida).
 *
 * ⚠️ `unoptimized` É EXPLÍCITO, e não deve sair. O otimizador do Next recusa
 * SVG por padrão (é um formato executável), e ligar `dangerouslyAllowSVG`
 * abriria a porta para QUALQUER SVG remoto. O Next hoje já desliga o
 * otimizador sozinho quando o caminho termina em `.svg` — mas isso é detalhe
 * interno dele, não contrato. Declarado aqui, a marca não depende disso: o
 * arquivo é nosso e estático, servir direto de /public é mais seguro e não
 * perde nada, já que vetor não tem o que otimizar por resolução.
 */
export function ApcsMark({ className, height = 28 }: { className?: string; height?: number }) {
  return (
    <Image
      src={APCS_LOGO_SRC}
      alt={`${APP_SHORT_NAME} — ${APP_LEGAL_NAME}`}
      width={Math.round(height * RATIO)}
      height={height}
      style={{ height, width: "auto" }}
      priority
      unoptimized
      className={className}
    />
  );
}

/**
 * A assinatura completa: desenho, um fio de separação e o nome em duas linhas.
 *
 * ⚠️ O NOME É `aria-hidden`, E ISSO É PROPOSITAL. Ele já está no `alt` do
 * desenho — anunciá-lo duas vezes faria um leitor de tela ler "APCS,
 * Associação Paulista de Criadores de Suínos" e em seguida "Associação
 * Paulista de Criadores de Suínos" outra vez, em todo carregamento de página.
 *
 * ⚠️ A QUEBRA DE LINHA É MANUAL, e não `text-wrap: balance`. O nome tem de
 * cair sempre nos mesmos dois pedaços: na lateral de 256px, deixar o navegador
 * decidir produz ora duas ora três linhas conforme a fonte disponível, e três
 * linhas não cabem na altura da barra.
 */
export function ApcsLogo({
  className,
  height = 36,
  /** Esconde o nome abaixo de `sm`. Ligado por padrão: em telas estreitas a
   *  assinatura inteira não cabe, e o desenho sozinho ainda identifica. */
  responsive = true,
}: {
  className?: string;
  height?: number;
  responsive?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <ApcsMark height={height} />
      <span aria-hidden className={cn("bg-hairline h-7 w-px", responsive && "hidden sm:block")} />
      <span
        aria-hidden
        className={cn(
          "text-muted-foreground max-w-[15rem] text-[11px] leading-tight",
          responsive && "hidden sm:block",
        )}
      >
        Associação Paulista de
        <br />
        Criadores de Suínos
      </span>
    </span>
  );
}
