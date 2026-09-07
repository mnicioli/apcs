import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LandingBuilder } from "./landing-builder";
import type { LandingPageWithEvent } from "@/modules/event/event.landing.types";

/**
 * O BUILDER (§19, §22, §26, §28, §30).
 *
 * ⚠️ O QUE ESTE ARQUIVO PROVA É QUE A TELA NÃO DECIDE NADA SOZINHA. Cada teste
 * abaixo confere que a decisão está onde deve estar: as regras de negócio no
 * banco, a permissão no RBAC, e aqui só a apresentação — quais campos existem,
 * quais ficam desabilitados, e o que é enviado ao servidor.
 *
 * As actions são `"use server"`: importá-las de verdade abriria o Supabase.
 */

const updateLandingPageAction = vi.hoisted(() => vi.fn());
const setLandingPageStatusAction = vi.hoisted(() => vi.fn());
const requestLandingImageUploadAction = vi.hoisted(() => vi.fn());
const setLandingPageImageAction = vi.hoisted(() => vi.fn());
const removeLandingPageImageAction = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/event-landing", () => ({
  updateLandingPageAction,
  setLandingPageStatusAction,
  requestLandingImageUploadAction,
  setLandingPageImageAction,
  removeLandingPageImageAction,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const PADROES = {
  title: "INSCRIÇÃO CONFIRMADA!",
  message: "Seu cadastro para o {{event_name}} foi realizado com sucesso.",
  footer: "Esperamos você! Nos vemos no evento.",
};

function pagina(overrides: Partial<LandingPageWithEvent> = {}): LandingPageWithEvent {
  return {
    id: "l1",
    eventId: "e1",
    status: "draft",
    slug: "encontro-tecnico",
    imageUrl: null,
    successImageUrl: null,
    formFields: ["GRANJA_EMPRESA", "EMAIL", "NOME_PARTICIPANTE", "TELEFONE", "WHATSAPP"],
    closesAt: null,
    maxParticipants: null,
    participantCount: 0,
    createdBy: null,
    createdAt: "2026-09-01T10:00:00Z",
    updatedBy: null,
    updatedAt: "2026-09-01T10:00:00Z",
    publishedAt: null,
    publishedBy: null,
    event: {
      id: "e1",
      name: "Encontro Técnico",
      eventDate: "2026-09-18",
      startTime: "08:00",
      endTime: "13:00",
      location: "Toledo — PR",
      description: null,
      imageUrl: null,
    },
    ...overrides,
  };
}

function montar(overrides: Partial<LandingPageWithEvent> = {}, canWrite = true) {
  return render(
    <LandingBuilder
      page={pagina(overrides)}
      origin="https://apcs.example.org"
      successDefaults={PADROES}
      canWrite={canWrite}
    />,
  );
}

beforeEach(() => {
  updateLandingPageAction.mockReset();
  updateLandingPageAction.mockResolvedValue({
    ok: true,
    data: { id: "l1", slug: "encontro-tecnico" },
  });
  setLandingPageStatusAction.mockReset();
  refresh.mockReset();
});

describe("os dados do evento são só leitura (§7, §9)", () => {
  /**
   * ⚠️ O §9 É EXPLÍCITO: "A alteração do título da Landing Page não deve
   * alterar o nome oficial do evento." A forma escolhida de garantir isso é não
   * haver o que alterar — o nome aparece como texto, e quem quiser mudá-lo vai
   * para a tela do evento.
   */
  it("mostra nome, data e local, e não oferece campo para editá-los", () => {
    montar();

    // Nome e local aparecem mais de uma vez — no cartão do evento e na prévia.
    // O que importa aqui é que aparecem, e que nenhum deles é editável.
    expect(screen.getAllByText("Encontro Técnico").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Toledo — PR").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/nome do evento/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /editar o evento/i })).toHaveAttribute(
      "href",
      "/events/e1/edit",
    );
  });
});

describe("o endereço público (§27)", () => {
  it("monta a URL com a origem que veio do servidor", () => {
    montar();
    expect(
      screen.getByText("https://apcs.example.org/eventos/encontro-tecnico"),
    ).toBeInTheDocument();
  });

  /**
   * ⚠️ O AVISO NÃO É DECORAÇÃO. Enquanto a página é rascunho, este endereço não
   * abre — copiá-lo e mandar para alguém produziria um 404 e um telefonema.
   */
  it("em rascunho, avisa que o endereço ainda não funciona", () => {
    montar({ status: "draft" });
    expect(screen.getByText(/só passa a funcionar depois/i)).toBeInTheDocument();
  });

  it("publicada, diz que está no ar", () => {
    montar({ status: "published", publishedAt: "2026-09-02T10:00:00Z" });
    expect(screen.getByText(/está no ar neste endereço/i)).toBeInTheDocument();
  });
});

describe("salvar (§22, §28)", () => {
  it("começa sem nada a salvar, e o botão fica desabilitado", () => {
    montar();
    expect(screen.getByRole("button", { name: "Salvo" })).toBeDisabled();
  });

  it("mexer em qualquer campo habilita o salvar e avisa", async () => {
    const user = userEvent.setup();
    montar();

    await user.type(screen.getByLabelText("Capacidade máxima"), "120");

    expect(screen.getByRole("button", { name: "Salvar" })).toBeEnabled();
    expect(screen.getByText("Há alterações não salvas.")).toBeInTheDocument();
  });

  it("salvar envia o estado atual e some o aviso", async () => {
    const user = userEvent.setup();
    montar();

    await user.type(screen.getByLabelText("Capacidade máxima"), "120");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(updateLandingPageAction).toHaveBeenCalledTimes(1);
    const enviado = updateLandingPageAction.mock.calls[0]?.[0] as { maxParticipants: string };
    expect(enviado.maxParticipants).toBe("120");
  });

  /**
   * ⚠️ O QUE O BUILDER NÃO MANDA MAIS. Os quatro textos saíram do schema, e a
   * função Postgres perdeu os quatro parâmetros — mas uma action que continuasse
   * mandando `description: ""` compilaria (o schema ignora chave extra) e
   * apagaria em produção um texto que ninguém pediu para apagar. Esta asserção
   * é o que cobra o silêncio.
   */
  it("não manda mais descrição nem mensagem de confirmação", async () => {
    const user = userEvent.setup();
    montar();

    await user.type(screen.getByLabelText("Capacidade máxima"), "120");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    const enviado = updateLandingPageAction.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(enviado).sort()).toEqual([
      "closesAt",
      "formFields",
      "landingPageId",
      "maxParticipants",
      "slug",
    ]);
  });

  /**
   * ⚠️ O SLUG PODE VOLTAR DIFERENTE. Quem decide é `event_landing_free_slug` no
   * Postgres, que resolve colisão com `-2`, `-3`… Dizer isso na hora evita a
   * pessoa descobrir depois que o endereço que ela colou num WhatsApp não é o
   * que está no ar.
   */
  it("avisa quando o servidor devolve um endereço diferente do pedido", async () => {
    const user = userEvent.setup();
    updateLandingPageAction.mockResolvedValue({
      ok: true,
      data: { id: "l1", slug: "encontro-tecnico-2" },
    });
    montar();

    // Um endereço DIFERENTE do atual — senão nada fica sujo e o botão de
    // salvar continua desabilitado, que é o comportamento certo.
    await user.clear(screen.getByLabelText("Endereço personalizado"));
    await user.type(screen.getByLabelText("Endereço personalizado"), "encontro");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText(/ficou "encontro-tecnico-2"/)).toBeInTheDocument();
  });

  it("erro do servidor aparece traduzido, sem detalhe interno", async () => {
    const user = userEvent.setup();
    updateLandingPageAction.mockResolvedValue({
      ok: false,
      error: { code: "landingSlugTaken", constraint: "event_landing_pages_slug_key" },
    });
    montar();

    await user.type(screen.getByLabelText("Capacidade máxima"), "1");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("Escolha outro endereço");
    expect(alerta.textContent).not.toContain("event_landing_pages_slug_key");
  });
});

describe("o endereço é normalizado enquanto se digita (§6)", () => {
  it("acento, espaço e maiúscula não chegam ao campo", async () => {
    const user = userEvent.setup();
    montar();

    const campo = screen.getByLabelText("Endereço personalizado");
    await user.clear(campo);
    await user.type(campo, "Encontro Técnico");

    // `slugPreview` roda a cada tecla: o que a pessoa vê é o que vai ser
    // enviado, e não uma string que o servidor vai corrigir em silêncio.
    expect(campo).toHaveValue("encontro-tecnico");
  });
});

describe("a capacidade (§16)", () => {
  it("aceita só dígitos", async () => {
    const user = userEvent.setup();
    montar();

    const campo = screen.getByLabelText("Capacidade máxima");
    await user.type(campo, "100 pessoas");

    // Deixar digitar para recusar depois é pior do que não deixar digitar.
    expect(campo).toHaveValue("100");
  });

  it("diz quantas pessoas já estão inscritas", () => {
    montar({ participantCount: 18 });
    expect(screen.getByText(/hoje há 18/)).toBeInTheDocument();
  });
});

/**
 * ============================================================================
 * ⚠️ A CONFIRMAÇÃO VIROU UMA IMAGEM, E O TEXTO SAIU DO BUILDER.
 * ============================================================================
 * Aqui havia três casos sobre os campos de título, mensagem e rodapé, e sobre a
 * lista de variáveis que os acompanhava. Eles não foram esquecidos: o cliente
 * pediu a confirmação como BANNER, e os três campos deixaram de existir — na
 * tela, no schema e na assinatura da função Postgres.
 *
 * O que ficou no lugar são estas duas asserções, e elas são o oposto das
 * anteriores: a tela NÃO oferece mais o que a página não usa. Um teste que
 * apenas some deixaria a volta acidental dos campos passar sem uma palavra.
 */
describe("a confirmação é um banner, não um texto (§17)", () => {
  it("não há mais campo de título, mensagem ou rodapé de confirmação", () => {
    montar();
    expect(screen.queryByLabelText("Título")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Mensagem")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Mensagem final")).not.toBeInTheDocument();
    expect(screen.queryByText("{{event_name}}")).not.toBeInTheDocument();
  });

  it("nem campo de descrição da página", () => {
    montar();
    expect(screen.queryByLabelText("Descrição")).not.toBeInTheDocument();
  });

  it("no lugar deles há o envio das duas artes", () => {
    montar();
    expect(screen.getByLabelText("Imagem da página")).toBeInTheDocument();
    expect(screen.getByLabelText("Imagem da confirmação")).toBeInTheDocument();
  });
});

describe("a prévia acompanha o Builder (§19)", () => {
  /**
   * ⚠️ SEM SALVAR E SEM RECARREGAR. As duas colunas leem o mesmo estado; é isso
   * que faz a prévia em tempo real ser consequência do desenho em vez de um
   * recurso à parte.
   */
  it("reordenar os campos muda a prévia sem salvar", async () => {
    const user = userEvent.setup();
    montar();

    // WhatsApp é o 5º campo; mandá-lo para a 4ª posição o põe antes do
    // Telefone. É o `<select>` que substituiu as setas.
    await user.selectOptions(screen.getByLabelText("Posição de WhatsApp"), "4");

    const bloco = screen.getByText("Participante 1").parentElement?.parentElement;
    const texto = bloco?.textContent ?? "";
    expect(texto.indexOf("WhatsApp")).toBeLessThan(texto.indexOf("Telefone"));
    expect(updateLandingPageAction).not.toHaveBeenCalled();
  });

  it("a capacidade digitada aparece na prévia", async () => {
    const user = userEvent.setup();
    montar();

    await user.type(screen.getByLabelText("Capacidade máxima"), "50");

    expect(screen.getByText(/vagas limitadas: 50 participantes/i)).toBeInTheDocument();
  });
});

/**
 * ============================================================================
 * ⚠️ §30 — QUEM SÓ LÊ NÃO EDITA, E A TELA NÃO OFERECE O QUE ELE NÃO PODE.
 * ============================================================================
 * A garantia de verdade são as três camadas de sempre: `assertPermission` na
 * action, a RLS de `event_landing_pages` e o `raise 42501` das funções. O que
 * se prova aqui é que a tela não convida alguém a tentar.
 */
describe("somente leitura (§30)", () => {
  it("sem permissão de escrita, não há botão de salvar nem de publicar", () => {
    montar({}, false);

    expect(screen.queryByRole("button", { name: /salvar|salvo/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /publicar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tirar do ar/i })).not.toBeInTheDocument();
  });

  it("todos os campos vêm desabilitados", () => {
    montar({}, false);

    expect(screen.getByLabelText("Endereço personalizado")).toBeDisabled();
    expect(screen.getByLabelText("Capacidade máxima")).toBeDisabled();
  });

  it("a escolha de posição dos campos também", () => {
    montar({}, false);
    expect(screen.getByLabelText("Posição de E-mail")).toBeDisabled();
  });

  /** A tela continua servindo para CONSULTAR — que é para isso que ela abre. */
  it("mesmo assim mostra o endereço e a prévia", () => {
    montar({}, false);
    expect(
      screen.getByText("https://apcs.example.org/eventos/encontro-tecnico"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Celular" })).toBeInTheDocument();
  });
});

/**
 * §25 — não há versionamento de Landing Page, e o Prompt 2 não inventa um.
 * O que protege o histórico é outra coisa: inscrição gravada é imutável.
 */
describe("aviso de edição com inscritos (§25)", () => {
  it("aparece quando a página está no ar e já tem gente", () => {
    montar({ status: "published", publishedAt: "2026-09-02T10:00:00Z", participantCount: 12 });
    expect(screen.getByText(/nada do que já foi preenchido muda/i)).toBeInTheDocument();
  });

  it("não aparece em rascunho, nem sem inscritos", () => {
    montar({ status: "draft", participantCount: 0 });
    expect(screen.queryByText(/nada do que já foi preenchido muda/i)).not.toBeInTheDocument();

    montar({ status: "published", publishedAt: "2026-09-02T10:00:00Z", participantCount: 0 });
    expect(screen.queryByText(/nada do que já foi preenchido muda/i)).not.toBeInTheDocument();
  });
});

describe("publicar a partir do Builder (§22, §24)", () => {
  it("o botão publicar pede confirmação e chama a action", async () => {
    const user = userEvent.setup();
    setLandingPageStatusAction.mockResolvedValue({
      ok: true,
      data: { id: "l1", status: "published" },
    });
    montar({ status: "draft" });

    await user.click(screen.getByRole("button", { name: "Publicar" }));
    const dialogo = screen.getByRole("dialog");
    await user.click(within(dialogo).getByRole("button", { name: "Publicar" }));

    expect(setLandingPageStatusAction).toHaveBeenCalledWith({
      landingPageId: "l1",
      command: "publish",
    });
    // ⚠️ E RELÊ DO SERVIDOR. Sem isto, o Builder continuaria mostrando o estado
    // de antes de publicar — e o botão "Publicar" seguiria na tela.
    expect(refresh).toHaveBeenCalled();
  });
});
