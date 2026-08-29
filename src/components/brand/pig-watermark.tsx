import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * A MARCA D'ÁGUA DO SUÍNO — recorte da arte institucional da APCS.
 *
 * ⚠️ POR QUE UM RECORTE POR CSS, E NÃO UM ARQUIVO NOVO.
 *
 * A arte é `public/login-bg.jpg` (1672 × 941): dois suínos à direita, uma onda
 * vermelha embaixo, o selo da APCS no alto à esquerda e ícones no rodapé. Aqui
 * queremos SÓ O SUÍNO da frente — a onda vermelha atrás de uma conversa seria
 * uma faixa saturada cortando a leitura, e o selo repetido brigaria com a
 * assinatura que já está no topo da tela.
 *
 * Recortar por CSS mantém UM arquivo servindo os dois usos (o fundo do login e
 * esta marca d'água). Um segundo JPEG cortado seria mais bytes no repositório,
 * mais um binário para alguém reexportar errado, e — o pior — uma cópia que
 * silenciosamente diverge quando a APCS trocar a arte.
 *
 * ⚠️ POR QUE NÃO `object-fit: cover`. `cover` recorta em UMA dimensão só: ele
 * encaixa a imagem pela altura ou pela largura e sobra em cima da outra. Aqui é
 * preciso cortar nas DUAS (fora a onda embaixo E fora o selo à esquerda), o que
 * exige ampliar a imagem além do quadro. Daí a construção abaixo: um quadro com
 * `overflow-hidden` e, dentro dele, a imagem dimensionada em PORCENTAGEM DO
 * QUADRO. É a mesma conta que um editor de imagem faria, escrita em CSS:
 *
 *   largura da imagem = 100% / (fração da arte que se quer)
 *   deslocamento      = −(início do recorte / fração) × 100%
 *
 * As porcentagens são relativas ao quadro nos dois eixos (`top` em % resolve
 * pela ALTURA do bloco que o contém), então o recorte é o mesmo em qualquer
 * tamanho de tela. Nenhum número mágico: mude a caixa abaixo e a conta segue.
 */

/** O recorte, em frações da arte original. Medido sobre o arquivo, não chutado. */
const CROP = {
  /** Começa depois do suíno desfocado do fundo. */
  left: 0.66,
  /** Acima das orelhas, com uma folga de respiro. */
  top: 0.13,
  /** Vai até a borda direita da arte — o suíno é cortado lá no original também. */
  width: 0.34,
  /**
   * Para ANTES da onda vermelha.
   *
   * ⚠️ 0,65 — e já foi 0,69. A 0,69 sobrava uma lasca vermelha no canto
   * inferior direito do recorte: a onda sobe à medida que caminha para a
   * direita, e o canto do quadro pega justamente onde ela está mais alta. Foi
   * visto na tela, não deduzido — se mexer aqui, olhe o canto.
   */
  height: 0.65,
} as const;

/** Proporção do RECORTE (não a da arte inteira): 0,34 × 1672 por 0,69 × 941. */
const CROP_RATIO = `${Math.round(CROP.width * 1672)} / ${Math.round(CROP.height * 941)}`;

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

export function PigWatermark({ className }: { className?: string }) {
  return (
    <div
      // `aria-hidden` + `pointer-events-none`: é decoração. Um leitor de tela
      // anunciando "suíno" antes de cada conversa seria ruído puro, e um clique
      // que caísse aqui em vez de na mensagem seria um bug invisível.
      aria-hidden
      className={cn("pointer-events-none absolute overflow-hidden select-none", className)}
      style={{ aspectRatio: CROP_RATIO }}
    >
      <Image
        src="/login-bg.jpg"
        alt=""
        width={1672}
        height={941}
        // Decoração NUNCA é `priority`: ela não pode competir com a conversa
        // pela banda do primeiro carregamento.
        sizes="(min-width: 768px) 50vw, 100vw"
        style={{
          position: "absolute",
          maxWidth: "none",
          width: pct(1 / CROP.width),
          height: pct(1 / CROP.height),
          left: pct(-CROP.left / CROP.width),
          top: pct(-CROP.top / CROP.height),
        }}
      />
    </div>
  );
}
