import { KPI_HINTS } from "@/modules/event/event.results.labels";
import {
  barWidth,
  formatAverage,
  formatPercent,
  hasAverage,
  largestOption,
  optionPercent,
  ratingScaleMax,
} from "@/modules/event/event.results.rules";
import type { ResultsQuestion, ResultsSection } from "@/modules/event/event.results.types";
import { Card, CardContent } from "@/components/ui/card";

/**
 * OS GRÁFICOS DO PAINEL DE RESULTADOS (§12, §39).
 *
 * ============================================================================
 * ⚠️ HTML E CSS, SEM BIBLIOTECA DE GRÁFICOS — e é o padrão que este projeto já
 * tem, em `surveys/survey-results-chart.tsx`.
 * ============================================================================
 * O comentário de lá continua valendo inteiro: um gráfico de barras horizontais
 * é uma lista com larguras proporcionais, e feito assim ele já nasce acessível
 * (é uma TABELA DE VERDADE para quem usa leitor de tela), imprimível, e muda de
 * tema junto com o resto. Uma biblioteca traria um `<canvas>` que não é nada
 * disso — e o §39 pede "gráficos com informação textual equivalente".
 *
 * ⚠️ A BARRA É DECORATIVA (`aria-hidden`), E O NÚMERO ESTÁ SEMPRE ESCRITO AO
 * LADO. Quem não a enxerga não perde informação nenhuma. É o §39 outra vez:
 * "estados não comunicados apenas por cor".
 *
 * ⚠️ E SÃO POUCOS GRÁFICOS, de propósito (§12: "não exagerar na quantidade... o
 * dashboard deve priorizar leitura executiva"). Barras para média, barras para
 * distribuição, cartões para os números. Sem pizza, sem donut, sem linha do
 * tempo.
 */

/* -------------------------------------------------------------------------- */
/* Cartão de indicador (§5)                                                    */
/* -------------------------------------------------------------------------- */

export function KpiCard({
  label,
  value,
  hint,
  destaque,
  alerta,
}: {
  label: string;
  value: string | number;
  hint?: string;
  destaque?: boolean;
  alerta?: boolean;
}) {
  return (
    <Card className={destaque ? "border-primary/40" : undefined}>
      <CardContent className="p-4">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p
          className={`mt-1 text-2xl font-semibold tabular-nums ${
            alerta ? "text-destructive" : destaque ? "text-primary-strong" : ""
          }`}
        >
          {value}
        </p>
        {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* A média de uma pergunta, em barra (§10)                                     */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ A BARRA VAI ATÉ O TETO DA ESCALA, e não até a maior média do bloco.
 *
 * Aqui a comparação que interessa é "4,7 de 5", e não "esta pergunta contra a
 * vizinha". Normalizar pela maior média faria a pior pergunta de um evento
 * excelente parecer curta, e a melhor de um evento ruim parecer cheia — dois
 * enganos que a leitura executiva do §12 não perdoa.
 *
 * ⚠️ E O TETO VEM DAS OPÇÕES (§9: "não assumir que todas as avaliações futuras
 * obrigatoriamente terão 5 opções"). Uma escala de 0 a 10 desenharia barras pela
 * metade se o divisor fosse um `5` escrito no código.
 */
export function AverageBars({ questions }: { questions: ResultsQuestion[] }) {
  const comMedia = questions.filter(hasAverage);
  if (comMedia.length === 0) return null;

  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Média de cada pergunta de nota deste bloco</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Pergunta</th>
          <th scope="col">Média</th>
          <th scope="col">Respostas</th>
        </tr>
      </thead>
      <tbody>
        {comMedia.map((pergunta) => {
          const teto = ratingScaleMax(pergunta);
          const media = pergunta.average ?? 0;

          return (
            <tr key={pergunta.questionId}>
              <th scope="row" className="w-full py-2 pr-4 text-left align-top font-normal">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span>{pergunta.prompt}</span>
                  <span className="shrink-0 text-xs tabular-nums">
                    <strong className="text-sm">{formatAverage(media)}</strong>
                    <span className="text-muted-foreground"> / {teto}</span>
                  </span>
                </div>

                <div
                  className="bg-muted h-2.5 w-full overflow-hidden rounded-full"
                  aria-hidden="true"
                >
                  <div
                    className="bg-primary h-full rounded-full"
                    style={{ width: `${Math.min((media / teto) * 100, 100)}%` }}
                  />
                </div>
              </th>
              <td className="sr-only">{formatAverage(media)}</td>
              <td className="sr-only">{pergunta.answers} respostas</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* -------------------------------------------------------------------------- */
/* A distribuição de uma pergunta (§7, §9, §36, §37)                           */
/* -------------------------------------------------------------------------- */

export function DistributionBars({ question }: { question: ResultsQuestion }) {
  if (question.options.length === 0) return null;

  const maior = largestOption(question.options);
  const multipla = question.type === "multiple_choice";

  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Distribuição das respostas de &ldquo;{question.prompt}&rdquo;: quantas pessoas escolheram
          cada alternativa e qual percentual
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Alternativa</th>
            <th scope="col">Respostas</th>
            <th scope="col">Percentual</th>
          </tr>
        </thead>
        <tbody>
          {question.options.map((opcao) => {
            const percentual = optionPercent(opcao, question.respondents);

            return (
              <tr key={opcao.optionId}>
                <th scope="row" className="w-full py-1.5 pr-4 text-left align-top font-normal">
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span>
                      {/* ⚠️ O VALOR NA FRENTE DO RÓTULO, como o §7 mostra
                          ("5 — Excelente"). Ele é o que permite conferir a conta
                          da média sem abrir o formulário. */}
                      {opcao.value !== null && (
                        <span className="text-muted-foreground tabular-nums">{opcao.value} — </span>
                      )}
                      {opcao.label}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {opcao.total} · {formatPercent(percentual)}%
                    </span>
                  </div>

                  <div
                    className="bg-muted h-2 w-full overflow-hidden rounded-full"
                    aria-hidden="true"
                  >
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${barWidth(opcao.total, maior)}%` }}
                    />
                  </div>
                </th>
                <td className="sr-only">{opcao.total}</td>
                <td className="sr-only">{formatPercent(percentual)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ⚠️ O AVISO DA MÚLTIPLA ESCOLHA (§36: "deixar isso claro visualmente").
          Sem ele, uma soma de 180% parece erro de cálculo. */}
      {multipla && question.respondents > 0 && (
        <p className="text-muted-foreground text-xs">{KPI_HINTS.multipleChoice}</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Um bloco inteiro (§10, §33)                                                 */
/* -------------------------------------------------------------------------- */

export function SectionResults({
  section,
  mostrarVersao,
}: {
  section: ResultsSection;
  mostrarVersao: boolean;
}) {
  const quantitativas = section.questions.filter(hasAverage);
  const demais = section.questions.filter((q) => !hasAverage(q));

  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 className="font-semibold tracking-tight">
              {section.title}
              {/* ⚠️ A VERSÃO SÓ APARECE QUANDO HÁ MAIS DE UMA (§21). Com uma só,
                  o rótulo seria ruído em cada bloco da tela. */}
              {mostrarVersao && (
                <span className="text-muted-foreground ml-2 text-xs font-normal">
                  versão {section.version}
                </span>
              )}
            </h3>
            {section.description && (
              <p className="text-muted-foreground text-xs">{section.description}</p>
            )}
          </div>

          {/* §33. A média do bloco — só quando ele tem pergunta quantitativa.
              Um bloco só de comentários não tem média, e mostrar "—" ali
              sugeriria que a conta falhou. */}
          {section.average !== null && (
            <p className="text-sm">
              <span className="text-muted-foreground">Média do bloco </span>
              <strong className="tabular-nums">{formatAverage(section.average)}</strong>
            </p>
          )}
        </div>

        {quantitativas.length > 0 && <AverageBars questions={quantitativas} />}

        {/* ⚠️ A DISTRIBUIÇÃO DE CADA PERGUNTA DE NOTA VEM DEPOIS DAS MÉDIAS, e
            não no lugar delas (§10 mostra as médias; §9 pede a distribuição). As
            médias respondem "como foi o bloco"; a distribuição responde "quem
            reclamou" — e é a segunda que faz alguém agir. */}
        {quantitativas.map((pergunta) => (
          <details key={pergunta.questionId} className="border-border rounded-md border p-3">
            <summary className="cursor-pointer text-sm">
              Distribuição — {pergunta.prompt}
              <span className="text-muted-foreground ml-2 text-xs tabular-nums">
                {pergunta.answers} {pergunta.answers === 1 ? "resposta" : "respostas"} · mín{" "}
                {pergunta.min ?? "—"} · máx {pergunta.max ?? "—"}
              </span>
            </summary>
            <div className="pt-3">
              <DistributionBars question={pergunta} />
            </div>
          </details>
        ))}

        {/* §35, §36, §37 — o que não tem média: escolha, Sim/Não e texto. */}
        {demais.map((pergunta) => (
          <div key={pergunta.questionId} className="space-y-2">
            <p className="text-sm font-medium">
              {pergunta.prompt}
              <span className="text-muted-foreground ml-2 text-xs font-normal tabular-nums">
                {pergunta.respondents} {pergunta.respondents === 1 ? "resposta" : "respostas"}
              </span>
            </p>

            {pergunta.type === "free_text" ? (
              // §13/§35. O texto livre não tem distribuição: tem quantidade, e
              // os comentários em si ficam na aba de Respostas, ao lado de quem
              // os escreveu.
              <p className="text-muted-foreground text-xs">
                {pergunta.textCount === 0
                  ? "Ninguém escreveu nada nesta pergunta."
                  : `${pergunta.textCount} ${
                      pergunta.textCount === 1 ? "comentário" : "comentários"
                    } — leia na aba Respostas, junto de quem escreveu.`}
              </p>
            ) : (
              <DistributionBars question={pergunta} />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
