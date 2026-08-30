import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SurveyAudienceCriterion } from "@/modules/survey/survey.types";
import { SurveyAudienceSelector } from "./survey-audience-selector";

const estimateAudienceAction = vi.hoisted(() => vi.fn());
const searchContactsAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/surveys", () => ({ estimateAudienceAction, searchContactsAction }));

const PUBLICOS = [
  { id: "a0000000-0000-4000-8000-000000000001", name: "Criadores", description: null },
  { id: "a0000000-0000-4000-8000-000000000002", name: "Técnicos", description: null },
];

/**
 * O SELETOR DE PÚBLICO depois de 09/09.
 *
 * ⚠️ ESTE ARQUIVO NASCEU DE UM DEFEITO RELATADO DA TELA: com a base de
 * associados cheia, montar uma enquete e marcar Perfil = Produtor · Associado ·
 * Fornecedor devolvia "Público estimado: Nenhum contato com telefone cadastrado
 * corresponde a esta segmentação".
 *
 * A causa estava no banco — Enquetes resolvia o público sobre `chat_contacts`,
 * a agenda do bot do site, enquanto Bolsa, Normativas e Eventos já disparavam
 * por `members` (20260909000000_survey_audience_members.sql). Mas o SINTOMA
 * estava aqui: a tela oferecia uma taxonomia (Produtor · Associado ·
 * Fornecedor) que a unificação de 28/08 já tinha aposentado.
 *
 * O que estes testes protegem é que a tela continue perguntando o que o banco
 * sabe responder — nem uma dimensão a mais.
 */
describe("SurveyAudienceSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    estimateAudienceAction.mockResolvedValue({ ok: true, data: { eligible: 0 } });
    searchContactsAction.mockResolvedValue({ ok: true, data: [] });
  });

  function montar(criteria: SurveyAudienceCriterion[] = [], onChange = vi.fn()) {
    return {
      onChange,
      ...render(
        <SurveyAudienceSelector
          criteria={criteria}
          onChange={onChange}
          segments={PUBLICOS}
          regions={["SP", "MG"]}
          contactNames={new Map()}
        />,
      ),
    };
  }

  it("oferece os públicos-alvo do cadastro de associados", () => {
    montar();

    expect(screen.getByRole("button", { name: "Criadores" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Técnicos" })).toBeInTheDocument();
  });

  /**
   * ⚠️ O CORAÇÃO DA CORREÇÃO. Produtor · Associado · Fornecedor eram os perfis
   * da TRIAGEM do bot, e nenhum associado tem esse campo preenchido — marcá-los
   * era a receita garantida para o público zero. Se voltarem a aparecer como
   * opção clicável, o defeito voltou junto.
   */
  it("não oferece mais o perfil da triagem — ele virou o público-alvo", () => {
    const { container } = montar();

    for (const aposentado of ["Produtor", "Associado", "Fornecedor"]) {
      expect(screen.queryByRole("button", { name: aposentado })).toBeNull();
    }

    // Perfil aparece, sim — desabilitado e explicado, para quem procurar por ele
    // descobrir para onde foi em vez de achar que sumiu.
    const indisponiveis = [...container.querySelectorAll('[aria-disabled="true"]')].map(
      (el) => el.textContent ?? "",
    );
    expect(indisponiveis.some((texto) => texto.startsWith("Perfil"))).toBe(true);
    expect(indisponiveis.some((texto) => /virou o Público-alvo/i.test(texto))).toBe(true);
  });

  /**
   * O id manda; o nome viaja junto porque o diálogo de agendamento — a última
   * tela antes do disparo — mostra o público e nunca passou pelo banco numa
   * enquete nova. Sem o nome ele exibiria um uuid.
   */
  it("clicar num público-alvo grava o id, e o nome junto para a tela", async () => {
    const usuario = userEvent.setup();
    const { onChange } = montar();

    await usuario.click(screen.getByRole("button", { name: "Criadores" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const proximo = onChange.mock.calls[0]?.[0] as (
      atual: SurveyAudienceCriterion[],
    ) => SurveyAudienceCriterion[];

    expect(proximo([])).toEqual([
      {
        dimension: "segment",
        segmentId: "a0000000-0000-4000-8000-000000000001",
        segmentName: "Criadores",
        contactId: null,
        value: null,
      },
    ]);
  });

  it("clicar de novo no mesmo público-alvo o remove", async () => {
    const usuario = userEvent.setup();
    const jaMarcado: SurveyAudienceCriterion[] = [
      {
        dimension: "segment",
        segmentId: PUBLICOS[0]!.id,
        contactId: null,
        value: null,
      },
    ];
    const { onChange } = montar(jaMarcado);

    await usuario.click(screen.getByRole("button", { name: "Criadores" }));

    const proximo = onChange.mock.calls[0]?.[0] as (
      atual: SurveyAudienceCriterion[],
    ) => SurveyAudienceCriterion[];
    expect(proximo(jaMarcado)).toEqual([]);
  });

  /**
   * §24. O atalho dispensa os demais critérios — e limpa os que havia. Deixar um
   * público-alvo marcado ao lado de "Toda a base" sugeriria uma restrição que
   * não existe.
   */
  it("marcar toda a base limpa o público-alvo escolhido", async () => {
    const usuario = userEvent.setup();
    const comPublico: SurveyAudienceCriterion[] = [
      { dimension: "segment", segmentId: PUBLICOS[0]!.id, contactId: null, value: null },
    ];
    const { onChange } = montar(comPublico);

    await usuario.click(screen.getByRole("checkbox"));

    const proximo = onChange.mock.calls[0]?.[0] as (
      atual: SurveyAudienceCriterion[],
    ) => SurveyAudienceCriterion[];
    expect(proximo(comPublico)).toEqual([
      { dimension: "all", segmentId: null, contactId: null, value: null },
    ]);
  });

  /**
   * ⚠️ A ESTIMATIVA VEM DO BANCO, e é isso que faz o número da tela e o número
   * do disparo serem o mesmo número. Um cálculo em TypeScript divergiria no
   * primeiro ajuste da regra — e a divergência só apareceria depois do envio.
   */
  it("a estimativa é pedida ao servidor com os critérios da tela", async () => {
    estimateAudienceAction.mockResolvedValue({ ok: true, data: { eligible: 42 } });

    montar([{ dimension: "segment", segmentId: PUBLICOS[0]!.id, contactId: null, value: null }]);

    expect(await screen.findByText(/42 associados receberão esta enquete/i)).toBeInTheDocument();
    expect(estimateAudienceAction).toHaveBeenCalledWith([
      { dimension: "segment", segmentId: PUBLICOS[0]!.id, contactId: null, value: null },
    ]);
  });

  it("falha de estimativa não derruba a tela — o número some, o resto fica", async () => {
    estimateAudienceAction.mockResolvedValue({ ok: false, error: { code: "unexpected" } });

    montar([{ dimension: "region", segmentId: null, contactId: null, value: "SP" }]);

    expect(await screen.findByText(/não foi possível calcular o público/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Criadores" })).toBeInTheDocument();
  });

  it("público fotografado trava a escolha, sem esconder o que foi escolhido", () => {
    render(
      <SurveyAudienceSelector
        criteria={[
          { dimension: "segment", segmentId: PUBLICOS[0]!.id, contactId: null, value: null },
        ]}
        onChange={vi.fn()}
        segments={PUBLICOS}
        regions={["SP"]}
        contactNames={new Map()}
        locked
      />,
    );

    expect(screen.getByRole("button", { name: "Criadores" })).toBeDisabled();
    expect(screen.getByText(/volte a enquete para rascunho/i)).toBeInTheDocument();
  });
});
