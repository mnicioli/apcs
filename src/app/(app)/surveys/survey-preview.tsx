import { numberEmoji, surveyValidityLine } from "@/modules/survey/survey.labels";

/**
 * O PREVIEW DA MENSAGEM (§19, §70).
 *
 * ⚠️ Mostra APROXIMADAMENTE o que o associado recebe, e a palavra
 * "aproximadamente" está na tela de propósito — o §19 pede a representação, não
 * uma promessa. O WhatsApp renderiza `*negrito*` e quebra linhas do seu jeito, e
 * jurar fidelidade pixel a pixel seria mentir sobre algo que não controlamos.
 *
 * ⚠️ E o preview NÃO carrega resultado parcial. Não é esquecimento: mandar
 * "já votaram 40% em Aumentar" junto com a pergunta enviesaria a enquete — a
 * pessoa responderia sabendo o que os outros responderam.
 *
 * Componente de SERVIDOR: não tem estado nem interação, só desenha o que recebe.
 * Um `"use client"` aqui carregaria JavaScript para renderizar texto parado.
 */
export function SurveyPreview({
  title,
  description,
  question,
  options,
  startsAt,
  endsAt,
  className,
}: {
  title?: string;
  description?: string;
  question: string;
  options: readonly string[];
  /** Instantes ISO, como `surveyWhatsAppMessage` recebe. */
  startsAt?: string;
  endsAt?: string;
  className?: string;
}) {
  const validas = options.map((o) => o.trim()).filter((o) => o !== "");
  const titulo = title?.trim();
  const descricao = description?.trim();

  // ⚠️ A MESMA FUNÇÃO QUE MONTA A FRASE ENVIADA. Escrever a data de novo aqui
  // faria a prévia e o WhatsApp discordarem no dia em que uma das duas mudasse
  // — e a prévia existe justamente para que ninguém precise mandar para
  // descobrir como ficou.
  const prazo = surveyValidityLine(startsAt, endsAt);

  return (
    <div className={className}>
      {/* ⚠️ O PALCO EXISTE PARA A BOLHA PARECER UMA MENSAGEM RECEBIDA, e não um
          cartão do formulário. Sem um fundo atrás dela, a prévia se confunde com
          os campos ao redor e a pessoa deixa de lê-la como "isto é o que vai
          chegar no celular de alguém" — que é a única razão de ela existir.

          O padrão é desenhado com `radial-gradient` sobre tokens de cor: nada de
          imagem para carregar, e ele acompanha o tema claro/escuro sozinho. */}
      <div
        className="border-border bg-muted/40 relative mx-auto max-w-sm overflow-hidden rounded-xl border p-5"
        // O preview é uma REPRESENTAÇÃO do que vai ser enviado; para o leitor de
        // tela ele é anunciado como um bloco só, com o rótulo dizendo o que é.
        role="group"
        aria-label="Prévia da mensagem que o associado receberá"
      >
        {/* ⚠️ O PADRÃO VIVE NUMA CAMADA PRÓPRIA, com `text-border` nela mesma.
            `currentColor` resolve para a cor de texto DO ELEMENTO que declara o
            gradiente — posto no contêiner de fora, ele herdaria a cor do texto e
            o fundo viraria uma tela de pontos escuros por cima do formulário. */}
        <div
          className="text-border pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(currentColor 0.5px, transparent 0.5px), radial-gradient(currentColor 0.5px, transparent 0.5px)",
            backgroundSize: "18px 18px",
            backgroundPosition: "0 0, 9px 9px",
          }}
        />

        {/* ⚠️ O CANTO SUPERIOR ESQUERDO É RETO. É a forma que o WhatsApp dá a uma
            mensagem RECEBIDA — o detalhe que faz o olho reconhecer a bolha antes
            de ler qualquer palavra. */}
        <div className="bg-background border-border relative space-y-3 rounded-lg rounded-tl-none border px-4 py-3 shadow-sm">
          <p className="text-primary-strong text-xs font-semibold">
            APCS — Associação Paulista de Criadores de Suínos
          </p>

          <div className="space-y-1">
            {/* Negrito porque no WhatsApp ele sai entre asteriscos. A prévia
                mostra o RESULTADO, não a marcação. */}
            <p className="text-sm leading-snug font-semibold">
              {titulo || <span className="text-muted-foreground">O título aparecerá aqui.</span>}
            </p>
            {descricao && (
              <p className="text-sm leading-relaxed whitespace-pre-line">{descricao}</p>
            )}
          </div>

          <p className="text-sm leading-relaxed whitespace-pre-line">
            {question.trim() || "A pergunta da enquete aparecerá aqui."}
          </p>

          {validas.length > 0 ? (
            <ul className="space-y-1.5">
              {validas.map((option, indice) => (
                <li key={indice} className="flex items-start gap-2 text-sm">
                  <span aria-hidden="true">{numberEmoji(indice + 1)}</span>
                  <span className="min-w-0 flex-1">{option}</span>
                  {/* O número precisa existir em texto para quem não vê o emoji. */}
                  <span className="sr-only">opção {indice + 1}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              As alternativas aparecerão aqui, numeradas.
            </p>
          )}

          <p className="text-muted-foreground text-xs">Responda com o número da opção escolhida.</p>

          {prazo && <p className="text-muted-foreground text-xs italic">{prazo}</p>}

          {/* A hora da bolha: some para leitor de tela (é cenário, não conteúdo)
              e é o detalhe que fecha a ilusão de mensagem recebida. */}
          <p className="text-muted-foreground/70 pt-0.5 text-right text-[10px]" aria-hidden="true">
            agora
          </p>
        </div>
      </div>

      <p className="text-muted-foreground mt-2 text-center text-xs">
        Representação aproximada. O WhatsApp pode ajustar a formatação.
      </p>
    </div>
  );
}
