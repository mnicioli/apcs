import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * ⚠️ As actions são `"use server"`: importá-las de verdade faria `ChatToolbar`
 * chamar `cookies()` fora de uma requisição no `useEffect` que marca a conversa
 * como lida. O que está sob teste aqui é a TELA, não a escrita — a action tem
 * bateria própria em `src/lib/actions/whatsapp.test.ts`.
 */
vi.mock("@/lib/actions/whatsapp", () => ({
  markWhatsAppChatReadAction: vi.fn(async () => ({ ok: true, data: null })),
  archiveWhatsAppChatAction: vi.fn(async () => ({ ok: true, data: null })),
  sendWhatsAppMessageAction: vi.fn(async () => ({ ok: true, data: { messageId: "m" } })),
}));

const { ChatList } = await import("./chat-list");
const { Conversation } = await import("./conversation");
import type { WhatsAppParams } from "@/modules/whatsapp/whatsapp.routes";
import type {
  WhatsAppChat,
  WhatsAppConversation,
  WhatsAppMessage,
} from "@/modules/whatsapp/whatsapp.types";

/**
 * O QUE A CAIXA DE ENTRADA MOSTRA.
 *
 * Estes componentes são Server Components — mas são funções síncronas que
 * devolvem JSX, sem `await` e sem acesso ao banco, então renderizam num teste
 * normalmente. O que está sob teste é a DECISÃO DA TELA, e cada caso abaixo
 * existe porque errá-lo produziria uma tela que MENTE em silêncio:
 *
 *   • um anexo que não baixou aparecendo como bolha vazia;
 *   • uma conversa de grupo sem dizer quem falou;
 *   • uma mensagem que não foi entregue parecendo entregue;
 *   • duas mensagens de dias diferentes parecendo um diálogo contínuo.
 */

const PARAMS: WhatsAppParams = { filter: "all", search: "", chatId: null };

function chat(extra: Partial<WhatsAppChat> = {}): WhatsAppChat {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    phone: "5554991234567",
    isGroup: false,
    name: "João Suinocultor",
    photoUrl: null,
    contactId: null,
    memberId: null,
    unreadCount: 0,
    archived: false,
    lastMessageAt: "2026-08-19T13:00:00.000Z",
    lastMessagePreview: "Bom dia, preciso do boletim",
    lastMessageFromMe: false,
    ...extra,
  };
}

function mensagem(extra: Partial<WhatsAppMessage> = {}): WhatsAppMessage {
  return {
    id: "msg-1",
    direction: "inbound",
    origin: "contact",
    kind: "text",
    body: "Bom dia",
    senderName: null,
    participantPhone: null,
    status: "delivered",
    errorMessage: null,
    sentByName: null,
    occurredAt: "2026-08-19T13:00:00.000Z",
    media: null,
    ...extra,
  };
}

function conversa(
  mensagens: WhatsAppMessage[],
  extra: Partial<WhatsAppConversation> = {},
): WhatsAppConversation {
  return { ...chat(), messages: mensagens, ...extra };
}

const CONTAGENS = { all: 3, unread: 1, groups: 0, archived: 2 };

describe("a lista de conversas", () => {
  function renderLista(itens: WhatsAppChat[], params: WhatsAppParams = PARAMS) {
    return render(<ChatList params={params} items={itens} counts={CONTAGENS} truncated={false} />);
  }

  it("mostra o nome, a prévia e o horário", () => {
    renderLista([chat()]);
    expect(screen.getByText("João Suinocultor")).toBeInTheDocument();
    expect(screen.getByText("Bom dia, preciso do boletim")).toBeInTheDocument();
  });

  it("sem nome, mostra o telefone formatado — nunca uma linha em branco", () => {
    renderLista([chat({ name: null })]);
    expect(screen.getByText("(54) 99123-4567")).toBeInTheDocument();
  });

  it("⚠️ “Você:” antes da prévia diz quem está esperando por quem", () => {
    // Uma conversa cuja última mensagem é nossa está esperando pela PESSOA, não
    // pelo time. É a pergunta que a lista existe para responder sem abrir nada.
    renderLista([chat({ lastMessageFromMe: true })]);
    expect(screen.getByText("Você:")).toBeInTheDocument();
  });

  it("o contador de não lidas satura em 99+", () => {
    renderLista([chat({ unreadCount: 431 })]);
    expect(screen.getByText(/99\+/)).toBeInTheDocument();
  });

  it("conversa sem mensagem não inventa prévia", () => {
    renderLista([chat({ lastMessagePreview: null, lastMessageAt: null })]);
    expect(screen.getByText("Sem mensagens")).toBeInTheDocument();
  });

  it("as abas levam para o filtro certo e preservam a busca", () => {
    renderLista([chat()], { filter: "all", search: "silva", chatId: null });
    expect(screen.getByRole("link", { name: /Arquivadas/ })).toHaveAttribute(
      "href",
      "/whatsapp?filtro=archived&q=silva",
    );
  });

  it("a aba ativa se anuncia para o leitor de tela", () => {
    renderLista([chat()], { filter: "groups", search: "", chatId: null });
    expect(screen.getByRole("link", { name: /Grupos/ })).toHaveAttribute("aria-current", "page");
  });

  it("busca sem resultado diz O QUE foi procurado", () => {
    renderLista([], { filter: "all", search: "zebra", chatId: null });
    expect(screen.getByText(/Nenhuma conversa encontrada para “zebra”/)).toBeInTheDocument();
  });

  it("cada aba vazia diz uma coisa diferente", () => {
    renderLista([], { filter: "archived", search: "", chatId: null });
    expect(screen.getByText(/Nada arquivado/)).toBeInTheDocument();
  });

  it("⚠️ lista no teto AVISA que há mais, em vez de deixar concluir que não há", () => {
    render(<ChatList params={PARAMS} items={[chat()]} counts={CONTAGENS} truncated />);
    expect(screen.getByText(/há mais; use a busca/)).toBeInTheDocument();
  });

  it("a busca preserva o filtro num campo oculto", () => {
    const { container } = renderLista([chat()], {
      filter: "unread",
      search: "",
      chatId: null,
    });
    // Sem isto, buscar dentro de "Não lidas" jogaria a pessoa de volta em "Todas".
    expect(container.querySelector('input[type="hidden"][name="filtro"]')).toHaveValue("unread");
  });
});

describe("a conversa aberta", () => {
  const props = { params: PARAMS, canReply: false, canWrite: false };

  it("sem conversa escolhida, convida a escolher uma", () => {
    render(<Conversation conversation={null} {...props} />);
    expect(screen.getByText(/Escolha uma conversa/)).toBeInTheDocument();
  });

  it("id que não existe mais diz isso, em vez de fingir caixa vazia", () => {
    render(
      <Conversation
        conversation={null}
        {...props}
        params={{ ...PARAMS, chatId: "11111111-1111-4111-8111-111111111111" }}
      />,
    );
    expect(screen.getByText(/não existe mais/)).toBeInTheDocument();
  });

  it("o que SAIU vai para a direita; o que CHEGOU, para a esquerda", () => {
    const { container } = render(
      <Conversation
        conversation={conversa([
          mensagem({ id: "a", direction: "inbound", body: "Chegou" }),
          mensagem({ id: "b", direction: "outbound", origin: "agent", body: "Saiu" }),
        ])}
        {...props}
      />,
    );

    const linhas = container.querySelectorAll("ol > li > div");
    expect(linhas[0]?.className).toContain("justify-start");
    expect(linhas[1]?.className).toContain("justify-end");
  });

  it("⚠️ um separador de dia por dia, e nenhum a mais", () => {
    // Sem ele, mensagens de março e agosto viram um diálogo contínuo — e quem
    // lê responde a uma pergunta de cinco meses atrás como se fosse de agora.
    render(
      <Conversation
        conversation={conversa([
          mensagem({ id: "a", occurredAt: "2026-08-17T13:00:00.000Z" }),
          mensagem({ id: "b", occurredAt: "2026-08-17T14:00:00.000Z" }),
          mensagem({ id: "c", occurredAt: "2026-08-18T09:00:00.000Z" }),
        ])}
        {...props}
      />,
    );

    expect(screen.getAllByText("17/08/2026")).toHaveLength(1);
    expect(screen.getAllByText("18/08/2026")).toHaveLength(1);
  });

  it("em grupo, mostra quem falou", () => {
    render(
      <Conversation
        conversation={conversa([mensagem({ senderName: "Maria da Silva" })], {
          isGroup: true,
          name: "Núcleo Serra",
        })}
        {...props}
      />,
    );
    expect(screen.getByText("Maria da Silva")).toBeInTheDocument();
  });

  it("fora de grupo, NÃO repete o nome em toda bolha", () => {
    render(<Conversation conversation={conversa([mensagem({ senderName: "João" })])} {...props} />);
    // O nome aparece uma vez só, no cabeçalho da conversa.
    expect(screen.queryByText("João")).not.toBeInTheDocument();
  });

  it("⚠️ a mensagem que falhou mostra o MOTIVO, junto dela", () => {
    // Quem descobre três dias depois que a resposta não saiu precisa do motivo
    // junto da mensagem — não de um alerta que já desapareceu.
    render(
      <Conversation
        conversation={conversa([
          mensagem({
            direction: "outbound",
            origin: "agent",
            status: "failed",
            errorMessage: "número não tem WhatsApp",
          }),
        ])}
        {...props}
      />,
    );
    expect(screen.getByText("número não tem WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Não foi entregue")).toBeInTheDocument();
  });

  it("o visto de entrega tem texto para quem não enxerga o ícone", () => {
    render(
      <Conversation
        conversation={conversa([
          mensagem({ id: "a", direction: "outbound", origin: "agent", status: "read" }),
        ])}
        {...props}
      />,
    );
    expect(screen.getByText("Lida")).toBeInTheDocument();
  });

  it("mensagem automática se identifica como tal", () => {
    render(
      <Conversation
        conversation={conversa([mensagem({ direction: "outbound", origin: "bot" })])}
        {...props}
      />,
    );
    expect(screen.getByText("automática")).toBeInTheDocument();
  });

  it("mensagem do CRM mostra quem respondeu", () => {
    render(
      <Conversation
        conversation={conversa([
          mensagem({ direction: "outbound", origin: "agent", sentByName: "Ana Souza" }),
        ])}
        {...props}
      />,
    );
    expect(screen.getByText("Ana Souza")).toBeInTheDocument();
  });

  it("⚠️ NENHUM estado de anexo é silêncio", () => {
    const estados = [
      ["pending", /Baixando o arquivo/],
      ["failed", /Não foi possível baixar/],
      ["too_large", /grande demais/],
    ] as const;

    for (const [status, texto] of estados) {
      const { unmount } = render(
        <Conversation
          conversation={conversa([
            mensagem({
              kind: "image",
              body: "",
              media: {
                status,
                url: null,
                mimeType: "image/jpeg",
                fileName: null,
                sizeBytes: null,
                durationSeconds: null,
              },
            }),
          ])}
          {...props}
        />,
      );
      expect(screen.getByText(texto)).toBeInTheDocument();
      unmount();
    }
  });

  it("documento guardado vira um cartão com nome e tamanho", () => {
    render(
      <Conversation
        conversation={conversa([
          mensagem({
            kind: "document",
            body: "",
            media: {
              status: "stored",
              url: "https://exemplo.invalid/assinada",
              mimeType: "application/pdf",
              fileName: "nota-fiscal.pdf",
              sizeBytes: 1_500_000,
              durationSeconds: null,
            },
          }),
        ])}
        {...props}
      />,
    );

    const link = screen.getByRole("link", { name: /nota-fiscal\.pdf/ });
    expect(link).toHaveAttribute("href", "https://exemplo.invalid/assinada");
    expect(within(link).getByText(/1,4 MB/)).toBeInTheDocument();
  });

  it("tipo que não sabemos exibir diz isso, em vez de bolha vazia", () => {
    render(
      <Conversation
        conversation={conversa([mensagem({ kind: "unsupported", body: "" })])}
        {...props}
      />,
    );
    expect(screen.getByText(/Mensagem não suportada/)).toBeInTheDocument();
  });

  it("quem só pode ler vê a conversa e NÃO vê o campo de resposta", () => {
    render(<Conversation conversation={conversa([mensagem()])} {...props} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/não responder/)).toBeInTheDocument();
  });

  it("⚠️ integração desligada explica por que não dá para responder", () => {
    // Diferente de "você não tem permissão": o problema é do sistema, e quem
    // está com a mensagem escrita precisa saber que não adianta insistir.
    render(
      <Conversation
        conversation={conversa([mensagem()])}
        params={PARAMS}
        canReply={false}
        canWrite
      />,
    );
    expect(screen.getByText(/integração de WhatsApp está desligada/)).toBeInTheDocument();
  });

  it("conversa vinculada a um cadastro se anuncia", () => {
    render(<Conversation conversation={conversa([mensagem()], { contactId: "c1" })} {...props} />);
    expect(screen.getByText("No cadastro")).toBeInTheDocument();
  });

  it("conversa sem mensagem nenhuma diz isso", () => {
    render(<Conversation conversation={conversa([])} {...props} />);
    expect(screen.getByText(/Nenhuma mensagem nesta conversa ainda/)).toBeInTheDocument();
  });
});
