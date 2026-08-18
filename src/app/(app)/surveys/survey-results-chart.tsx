import type { SurveyMetrics, SurveyResultRow } from "@/modules/survey/survey.types";
import { formatarPercentual } from "./survey-metrics-cards";

/**
 * O GRÁFICO DE RESULTADOS (§43, §44).
 *
 * ⚠️ BARRAS, e não pizza. O §43 aceita "e/ou" e manda priorizar barras quando há
 * muitas opções — e para comparar cinco grandezas a barra ganha da pizza em
 * qualquer quantidade: ler ângulo é mais difícil que ler comprimento, e fatias
 * parecidas ficam indistinguíveis.
 *
 * ⚠️ E é HTML e CSS, sem biblioteca de gráficos. Não é economia de dependência
 * pela dependência: um gráfico de barras horizontais é uma lista com larguras
 * proporcionais, e feito assim ele já nasce acessível (é uma tabela de verdade
 * para quem usa leitor de tela), imprimível, e mudando de tema junto com o
 * resto. Uma biblioteca traria um `<canvas>` que não é nada disso.
 *
 * As alternativas com ZERO aparecem (§53 do prompt 1): "ninguém votou em Reduzir
 * muito" é um resultado, não uma ausência de dado.
 */
export function SurveyResultsChart({
  rows,
  totalResponses,
}: {
  rows: SurveyResultRow[];
  totalResponses: number;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Esta enquete não tem alternativas cadastradas.
      </p>
    );
  }

  // A barra mais longa vira 100% da largura — sem isso, um resultado em que a
  // maior alternativa tem 30% desenharia cinco barras curtinhas e o gráfico não
  // diria nada.
  const maior = Math.max(...rows.map((r) => r.total), 1);

  return (
    <table className="w-full text-sm">
      <caption className="sr-only">
        Resultado por alternativa: quantas respostas e qual percentual cada uma recebeu
      </caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Alternativa</th>
          <th scope="col">Respostas</th>
          <th scope="col">Percentual</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.optionId}>
            <th scope="row" className="w-full py-2 pr-4 text-left align-top font-normal">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className={row.active ? "" : "text-muted-foreground line-through"}>
                  <span className="text-muted-foreground tabular-nums">{row.position}.</span>{" "}
                  {row.text}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {row.total} · {formatarPercentual(row.percentage)}%
                </span>
              </div>

              {/* A barra é decorativa: o número já está escrito ao lado, então
                  quem não a enxerga não perde informação nenhuma (§61). */}
              <div
                className="bg-muted h-2.5 w-full overflow-hidden rounded-full"
                aria-hidden="true"
              >
                <div
                  className="bg-primary h-full rounded-full transition-all"
                  style={{ width: `${(row.total / maior) * 100}%` }}
                />
              </div>
            </th>
            <td className="sr-only">{row.total}</td>
            <td className="sr-only">{formatarPercentual(row.percentage)}%</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td className="text-muted-foreground pt-3 text-xs">
            {totalResponses === 0
              ? "Nenhuma resposta ainda."
              : `${totalResponses} ${totalResponses === 1 ? "resposta" : "respostas"} no total.`}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * O FUNIL (§46).
 *
 * Público → Enviado → Entregue → Lido → Respondeu. O valor dele é mostrar ONDE
 * se perde gente: um salto grande entre "Enviado" e "Entregue" é problema de
 * número de telefone; entre "Lido" e "Respondeu" é problema da pergunta.
 *
 * ⚠️ Só aparece quando há dado suficiente — é o §46 dizendo "quando houver dados
 * suficientes". Um funil com quatro zeros e um número no topo não mostra perda
 * nenhuma; mostra que o disparo não existe, e para isso já existe a nota nos
 * cards de métricas.
 */
export function SurveyFunnel({ metrics }: { metrics: SurveyMetrics }) {
  const etapas = [
    { rotulo: "Público", valor: metrics.totalAudience },
    { rotulo: "Enviado", valor: metrics.totalSent },
    { rotulo: "Entregue", valor: metrics.totalDelivered },
    { rotulo: "Lido", valor: metrics.totalRead },
    { rotulo: "Respondeu", valor: metrics.totalResponses },
  ];

  const topo = metrics.totalAudience;
  if (topo === 0) return null;

  // Sem nenhuma etapa intermediária preenchida não há funil — há um público e
  // respostas soltas. Mostrar três barras zeradas no meio sugeriria falha de
  // entrega, quando o que existe é ausência de integração.
  const temIntermediarias =
    metrics.totalSent > 0 || metrics.totalDelivered > 0 || metrics.totalRead > 0;
  if (!temIntermediarias) return null;

  return (
    <ol className="space-y-2">
      {etapas.map((etapa, indice) => {
        const anterior = indice === 0 ? null : (etapas[indice - 1]?.valor ?? null);
        const perda = anterior !== null && anterior > 0 ? anterior - etapa.valor : null;

        return (
          <li key={etapa.rotulo} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{etapa.rotulo}</span>
              <span className="tabular-nums">
                {etapa.valor.toLocaleString("pt-BR")}
                {perda !== null && perda > 0 && (
                  <span className="text-muted-foreground ml-2 text-xs">
                    −{perda.toLocaleString("pt-BR")}
                  </span>
                )}
              </span>
            </div>
            <div className="bg-muted h-2 w-full overflow-hidden rounded-full" aria-hidden="true">
              <div
                className="bg-primary h-full rounded-full"
                style={{ width: `${(etapa.valor / topo) * 100}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
