import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewLandingForm } from "./new-landing-form";
import type { EventForLanding } from "@/lib/services/event-landing";

/**
 * O PRIMEIRO PASSO DA CRIAÇÃO (§5).
 *
 * ⚠️ A LISTA JÁ CHEGA FILTRADA. Quem exclui os eventos que já têm página e os
 * que já passaram é `listEventsWithoutLandingPage`, no servidor — os dois
 * recortes existem porque as duas regras são do BANCO (LP005 e EV001). O que se
 * testa aqui é o que a TELA faz com a lista que recebe, inclusive quando ela
 * chega vazia.
 */

const createLandingPageAction = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/event-landing", () => ({ createLandingPageAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const EVENTOS: EventForLanding[] = [
  {
    id: "e1",
    name: "Encontro Técnico",
    eventDate: "2026-09-18",
    startTime: "08:00",
    endTime: "13:00",
    location: "Toledo — PR",
  },
  {
    id: "e2",
    name: "Workshop de Manejo",
    eventDate: "2026-10-02",
    startTime: "14:00",
    endTime: null,
    location: "Campinas — SP",
  },
];

beforeEach(() => {
  createLandingPageAction.mockReset();
  createLandingPageAction.mockResolvedValue({ ok: true, data: { id: "l9", slug: "encontro" } });
  push.mockReset();
});

describe("a lista de eventos", () => {
  it("oferece os eventos recebidos", () => {
    render(<NewLandingForm events={EVENTOS} />);

    expect(screen.getByRole("option", { name: /Encontro Técnico/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Workshop de Manejo/ })).toBeInTheDocument();
  });

  it("explica por que a lista é curta", () => {
    render(<NewLandingForm events={EVENTOS} />);
    expect(screen.getByText(/ainda não têm página de inscrição/i)).toBeInTheDocument();
  });

  /**
   * ⚠️ LISTA VAZIA NÃO É ERRO — é o estado normal de quem já criou todas as
   * páginas. A tela precisa dizer isso e oferecer o caminho de saída, em vez de
   * mostrar um seletor vazio que parece um defeito.
   */
  it("sem evento disponível, explica e oferece cadastrar um", () => {
    render(<NewLandingForm events={[]} />);

    expect(screen.getByText(/não há evento disponível/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /cadastrar evento/i })).toHaveAttribute(
      "href",
      "/events/new",
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("escolher e continuar", () => {
  it("continuar fica desabilitado até haver escolha", () => {
    render(<NewLandingForm events={EVENTOS} />);
    expect(screen.getByRole("button", { name: /continuar/i })).toBeDisabled();
  });

  /**
   * A confirmação do que foi escolhido, antes de criar. Um seletor com trinta
   * eventos de nomes parecidos erra fácil, e a página criada no evento errado
   * teria de ser tirada do ar à mão.
   */
  it("mostra os dados do evento escolhido antes de criar", async () => {
    const user = userEvent.setup();
    render(<NewLandingForm events={EVENTOS} />);

    await user.selectOptions(screen.getByRole("combobox"), "e2");

    expect(screen.getByText("Workshop de Manejo")).toBeInTheDocument();
    expect(screen.getByText("Campinas — SP")).toBeInTheDocument();
  });

  /**
   * ⚠️ O PRAZO NASCE NO INÍCIO DO EVENTO (§16), e a conversão é do NAVEGADOR.
   * O horário do evento é hora local da APCS; o banco guarda instante absoluto.
   * Montar isto no servidor (UTC, na Vercel) leria "08:00" como UTC e fecharia
   * as inscrições três horas antes.
   */
  it("cria com o prazo no início do evento e o formulário padrão", async () => {
    const user = userEvent.setup();
    render(<NewLandingForm events={EVENTOS} />);

    await user.selectOptions(screen.getByRole("combobox"), "e1");
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    const enviado = createLandingPageAction.mock.calls[0]?.[0] as {
      eventId: string;
      closesAt: string;
      formFields: string[];
    };

    expect(enviado.eventId).toBe("e1");
    expect(enviado.formFields).toEqual([
      "GRANJA_EMPRESA",
      "EMAIL",
      "NOME_PARTICIPANTE",
      "TELEFONE",
      "WHATSAPP",
    ]);
    // O instante corresponde a 18/09/2026 08:00 na hora local de quem digitou.
    expect(new Date(enviado.closesAt).getTime()).toBe(new Date("2026-09-18T08:00").getTime());
  });

  it("depois de criar, leva ao Builder daquela página", async () => {
    const user = userEvent.setup();
    render(<NewLandingForm events={EVENTOS} />);

    await user.selectOptions(screen.getByRole("combobox"), "e1");
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    expect(push).toHaveBeenCalledWith("/events/landing-pages/l9");
  });
});

/**
 * ⚠️ A LISTA É UMA CORTESIA, NÃO UMA GARANTIA (§5).
 *
 * Entre carregar esta tela e clicar em Continuar, outra pessoa pode ter criado
 * a página daquele evento. O `unique` de `event_id` recusa a segunda com LP005 —
 * e é essa mensagem, e não um "erro inesperado", que precisa chegar à tela.
 */
describe("quando o evento já ganhou uma página no meio do caminho", () => {
  it("mostra a mensagem do §5 e não navega", async () => {
    const user = userEvent.setup();
    createLandingPageAction.mockResolvedValue({
      ok: false,
      error: { code: "eventAlreadyHasLandingPage" },
    });
    render(<NewLandingForm events={EVENTOS} />);

    await user.selectOptions(screen.getByRole("combobox"), "e1");
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este evento já tem uma página de inscrição.",
    );
    expect(push).not.toHaveBeenCalled();
  });
});
