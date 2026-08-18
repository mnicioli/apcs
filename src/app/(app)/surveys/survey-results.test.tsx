import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { groupAudience } from "@/modules/survey/survey.rules";
import type {
  SurveyAudienceCriterion,
  SurveyMetrics,
  SurveyResultRow,
} from "@/modules/survey/survey.types";
import { SurveyAudienceSummary } from "./survey-audience-summary";
import { SurveyMetricsCards } from "./survey-metrics-cards";
import { SurveyPreview } from "./survey-preview";
import { SurveyFunnel, SurveyResultsChart } from "./survey-results-chart";

/**
 * As telas que MOSTRAM número — resultado, métricas, público e prévia.
 *
 * ⚠️ O que estes testes protegem é a HONESTIDADE da apresentação: a alternativa
 * com zero resposta aparece, o percentual não vira `NaN`, o público diz a regra
 * de combinação, e a prévia não carrega resultado parcial.
 */

function metrics(over: Partial<SurveyMetrics> = {}): SurveyMetrics {
  return {
    totalAudience: 0,
    totalSent: 0,
    totalDelivered: 0,
    totalRead: 0,
    totalResponses: 0,
    totalErrors: 0,
    participationRate: 0,
    ...over,
  };
}

const RESULTADO: SurveyResultRow[] = [
  {
    optionId: "1",
    position: 1,
    text: "Aumentar muito",
    active: true,
    total: 100,
    percentage: 22.8,
  },
  { optionId: "2", position: 2, text: "Aumentar", active: true, total: 160, percentage: 36.5 },
  { optionId: "3", position: 3, text: "Manter", active: true, total: 98, percentage: 22.4 },
  { optionId: "4", position: 4, text: "Reduzir", active: true, total: 61, percentage: 13.9 },
  { optionId: "5", position: 5, text: "Reduzir muito", active: true, total: 0, percentage: 0 },
];

describe("SurveyResultsChart (§43, §44)", () => {
  it("mostra o exemplo do §44 com respostas e percentual", () => {
    render(<SurveyResultsChart rows={RESULTADO} totalResponses={419} />);

    expect(screen.getByText(/Aumentar muito/)).toBeInTheDocument();
    // Percentual em português: vírgula decimal.
    expect(screen.getByText(/160 · 36,5%/)).toBeInTheDocument();
  });

  it("⚠️ a alternativa com ZERO aparece", () => {
    render(<SurveyResultsChart rows={RESULTADO} totalResponses={419} />);

    // "Ninguém votou em Reduzir muito" é um RESULTADO, não uma ausência de dado.
    // Escondê-la faria o gráfico mentir por omissão.
    expect(screen.getByText(/Reduzir muito/)).toBeInTheDocument();
    expect(screen.getByText(/0 · 0%/)).toBeInTheDocument();
  });

  it("é uma tabela de verdade para quem usa leitor de tela (§61)", () => {
    render(<SurveyResultsChart rows={RESULTADO} totalResponses={419} />);

    // A barra é decorativa; o número está escrito. Um `<canvas>` de biblioteca
    // não teria nada disso.
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("rowheader")).toHaveLength(5);
  });

  it("sem respostas, diz que não há respostas", () => {
    const zerado = RESULTADO.map((r) => ({ ...r, total: 0, percentage: 0 }));
    render(<SurveyResultsChart rows={zerado} totalResponses={0} />);

    expect(screen.getByText(/nenhuma resposta ainda/i)).toBeInTheDocument();
  });

  it("alternativa inativa aparece marcada, e não some (§61 do banco)", () => {
    const comInativa = [
      ...RESULTADO.slice(0, 4),
      { ...RESULTADO[4]!, active: false, total: 12, percentage: 3 },
    ];
    render(<SurveyResultsChart rows={comInativa} totalResponses={431} />);

    expect(screen.getByText(/Reduzir muito/)).toBeInTheDocument();
  });
});

describe("SurveyFunnel (§46)", () => {
  it("mostra as cinco etapas quando há dado de entrega", () => {
    render(
      <SurveyFunnel
        metrics={metrics({
          totalAudience: 100,
          totalSent: 90,
          totalDelivered: 80,
          totalRead: 60,
          totalResponses: 40,
        })}
      />,
    );

    for (const etapa of ["Público", "Enviado", "Entregue", "Lido", "Respondeu"]) {
      expect(screen.getByText(etapa)).toBeInTheDocument();
    }
    // A perda entre etapas é o que faz o funil valer a pena. São duas quedas de
    // 10 (100→90→80) e duas de 20 (80→60→40).
    expect(screen.getAllByText("−10")).toHaveLength(2);
    expect(screen.getAllByText("−20")).toHaveLength(2);
  });

  it("⚠️ NÃO aparece quando não há envio nenhum", () => {
    // Sem integração de WhatsApp, três barras zeradas no meio sugeririam falha
    // de entrega — quando o que existe é ausência de disparo.
    const { container } = render(
      <SurveyFunnel metrics={metrics({ totalAudience: 50, totalResponses: 3 })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("não aparece sem público", () => {
    const { container } = render(<SurveyFunnel metrics={metrics()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SurveyMetricsCards (§42, §45)", () => {
  it("mostra os sete números do §42", () => {
    render(
      <SurveyMetricsCards
        metrics={metrics({
          totalAudience: 1245,
          totalSent: 1200,
          totalDelivered: 1100,
          totalRead: 800,
          totalResponses: 438,
          participationRate: 39.8,
        })}
      />,
    );

    // Milhar com ponto, como se escreve em português.
    expect(screen.getByText("1.245")).toBeInTheDocument();
    expect(screen.getByText("438")).toBeInTheDocument();
    expect(screen.getByText("39,8%")).toBeInTheDocument();
  });

  it("explica o zero em vez de deixá-lo mudo", () => {
    render(<SurveyMetricsCards metrics={metrics({ totalAudience: 50 })} />);

    expect(screen.getByText(/disparo por WhatsApp ainda não está integrado/i)).toBeInTheDocument();
  });

  it("sem público, não inventa explicação", () => {
    render(<SurveyMetricsCards metrics={metrics()} />);
    expect(screen.queryByText(/ainda não está integrado/i)).toBeNull();
  });
});

describe("SurveyAudienceSummary (§31)", () => {
  function crit(
    dimension: SurveyAudienceCriterion["dimension"],
    value: string | null,
  ): SurveyAudienceCriterion {
    return { dimension, segmentId: null, contactId: null, value };
  }

  it("diz a regra no texto: 'ou' dentro, '·' entre", () => {
    const { container } = render(
      <SurveyAudienceSummary
        criteria={[crit("region", "SP"), crit("region", "PR"), crit("profile", "producer")]}
      />,
    );

    // "Região: SP ou PR · Perfil: Produtor" — quem lê entende que precisa ser
    // produtor E estar num dos dois estados, sem aprender convenção nenhuma.
    const texto = container.textContent ?? "";
    expect(texto).toContain("SP ou PR");
    expect(texto).toContain("Perfil:");
    expect(texto).toContain("Produtor");
    // O separador visual é decorativo; a conjunção existe em texto para o
    // leitor de tela, senão as dimensões viram uma lista sem relação.
    expect(texto).toContain(" e ");
  });

  it("'toda a base' aparece sozinho", () => {
    render(<SurveyAudienceSummary criteria={[crit("all", null), crit("region", "SP")]} />);

    // O atalho dispensa os demais critérios; mostrá-los ao lado sugeriria uma
    // restrição que não existe.
    expect(screen.getByText("Toda a base")).toBeInTheDocument();
    expect(screen.queryByText(/SP/)).toBeNull();
  });

  it("sem critério, diz que o público não foi definido", () => {
    render(<SurveyAudienceSummary criteria={[]} />);
    expect(screen.getByText(/não definido/i)).toBeInTheDocument();
  });

  it("groupAudience agrupa por dimensão, na ordem da tela", () => {
    const grupos = groupAudience([
      crit("profile", "producer"),
      crit("region", "SP"),
      crit("region", "PR"),
    ]);

    expect(grupos.map((g) => g.dimension)).toEqual(["region", "profile"]);
    expect(grupos[0]?.values).toEqual(["SP", "PR"]);
  });
});

describe("SurveyPreview (§19, §70)", () => {
  it("mostra a enquete do §70 numerada", () => {
    render(
      <SurveyPreview
        question="Como você acredita que ficará o valor da @ do suíno nas próximas semanas?"
        options={["Aumentar muito", "Aumentar", "Manter", "Reduzir", "Reduzir muito"]}
      />,
    );

    expect(screen.getByText(/valor da @ do suíno/)).toBeInTheDocument();
    expect(screen.getByText("Aumentar muito")).toBeInTheDocument();
    expect(screen.getByText(/responda com o número/i)).toBeInTheDocument();
    // Cada opção tem o número em texto, não só no emoji (§61).
    expect(screen.getByText("opção 3")).toBeInTheDocument();
  });

  it("identifica a APCS (§41)", () => {
    render(<SurveyPreview question="P?" options={["A", "B"]} />);
    expect(screen.getByText(/APCS/)).toBeInTheDocument();
  });

  it("⚠️ NÃO mostra resultado parcial", () => {
    const { container } = render(
      <SurveyPreview question="Como ficará o valor?" options={["Sobe", "Desce"]} />,
    );

    // Mandar "já votaram 40% em Sobe" junto com a pergunta enviesaria a enquete:
    // a pessoa responderia sabendo o que os outros responderam.
    expect(container.textContent).not.toMatch(/\d+\s*%|votos|responderam|parcial/i);
  });

  it("com a pergunta em branco, explica o que vai aparecer ali", () => {
    render(<SurveyPreview question="" options={[]} />);

    expect(screen.getByText(/pergunta da enquete aparecerá aqui/i)).toBeInTheDocument();
    expect(screen.getByText(/alternativas aparecerão aqui/i)).toBeInTheDocument();
  });

  it("descarta alternativa em branco em vez de numerar um vazio", () => {
    render(<SurveyPreview question="P?" options={["Sim", "   ", "Não"]} />);

    expect(screen.getByText("opção 2")).toBeInTheDocument();
    expect(screen.queryByText("opção 3")).toBeNull();
  });
});
