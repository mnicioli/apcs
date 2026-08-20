import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/rbac/rbac.types";

/**
 * A RESPOSTA DO ATENDENTE — a única escrita deste módulo que sai da tela.
 *
 * Três coisas são testadas aqui, e nenhuma é a "mensagem chegou":
 *
 *   1. AUTORIZAÇÃO NA API, NÃO NO BOTÃO. Chamada direto, com o papel que não
 *      pode, tem de devolver `forbidden` E não tocar no banco. A segunda parte
 *      importa mais: uma action que grava e só depois nega já dependeu da RLS
 *      para não ter escrito.
 *
 *   2. A ORDEM: GRAVA PENDENTE → MANDA → LIQUIDA. É o que impede uma mensagem
 *      entregue numa chamada cuja resposta se perdeu de sumir do CRM — e ser
 *      mandada de novo para quem já a recebeu.
 *
 *   3. O DESTINO SAI DO BANCO. Um `to` vindo do formulário transformaria a tela
 *      de atendimento num disparador para qualquer número.
 *
 * ⚠️ O papel NÃO é mockado. O que se mocka é o Supabase e o fornecedor;
 * `getCurrentUserRole`, `hasPermission` e a matriz do RBAC rodam de verdade.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const rpc = vi.fn();
const maybeSingle = vi.fn();
let papelAtual: Role | null = "comercial";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: papelAtual === null ? null : { id: "11111111-1111-4111-8111-111111111111" } },
      }),
    },
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          returns: () => ({
            maybeSingle: async () =>
              tabela === "profiles"
                ? { data: papelAtual === null ? null : { role: papelAtual }, error: null }
                : maybeSingle(),
          }),
        }),
      }),
    }),
    rpc,
  }),
}));

const send = vi.fn();
vi.mock("@/lib/messaging/registry", () => ({
  messagingProvider: () => ({ name: "z_api", configured: configurado, missing: [], send }),
}));

let configurado = true;

const { archiveWhatsAppChatAction, markWhatsAppChatReadAction, sendWhatsAppMessageAction } =
  await import("./whatsapp");

const CHAT = "22222222-2222-4222-8222-222222222222";
const MSG = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  rpc.mockReset();
  send.mockReset();
  maybeSingle.mockReset();
  papelAtual = "comercial";
  configurado = true;

  maybeSingle.mockResolvedValue({ data: { chat_key: "5554991234567" }, error: null });
  rpc.mockImplementation(async (nome: string) =>
    nome === "whatsapp_start_outbound_message"
      ? { data: MSG, error: null }
      : { data: null, error: null },
  );
  send.mockResolvedValue({ ok: true, providerMessageId: "WA-1" });
});

describe("permissão", () => {
  const acoes: Array<[string, () => Promise<{ ok: boolean }>]> = [
    ["responder", () => sendWhatsAppMessageAction({ chatId: CHAT, body: "oi" })],
    ["marcar como lida", () => markWhatsAppChatReadAction(CHAT)],
    ["arquivar", () => archiveWhatsAppChatAction({ chatId: CHAT, archived: true })],
  ];

  for (const [nome, acao] of acoes) {
    it(`${nome}: quem não tem perfil é recusado sem tocar no banco`, async () => {
      papelAtual = null;
      const resultado = await acao();
      expect(resultado.ok).toBe(false);
      expect(rpc).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    it(`${nome}: o Financeiro é recusado sem tocar no banco`, async () => {
      papelAtual = "financeiro";
      const resultado = await acao();
      expect(resultado.ok).toBe(false);
      expect(rpc).not.toHaveBeenCalled();
    });
  }

  it("⚠️ o ATENDENTE responde — é o único módulo em que ele escreve", async () => {
    // Em Documentos, Eventos, Bolsa, Palestras e Associados o `comercial` só lê.
    // Aqui responder É o trabalho dele; uma caixa que ele abre e não responde
    // não serve para nada.
    papelAtual = "comercial";
    const resultado = await sendWhatsAppMessageAction({ chatId: CHAT, body: "Bom dia!" });
    expect(resultado.ok).toBe(true);
  });
});

describe("sendWhatsAppMessageAction", () => {
  it("⚠️ GRAVA PENDENTE antes de mandar, e LIQUIDA depois", async () => {
    await sendWhatsAppMessageAction({ chatId: CHAT, body: "Segue o boletim" });

    const ordem = rpc.mock.calls.map((c) => c[0]);
    expect(ordem).toEqual(["whatsapp_start_outbound_message", "whatsapp_settle_outbound_message"]);

    // E o envio aconteceu ENTRE os dois: a mensagem existia no banco antes de
    // sair, e o id do fornecedor só entrou depois de ele devolvê-lo.
    expect(send.mock.invocationCallOrder[0]).toBeGreaterThan(rpc.mock.invocationCallOrder[0]!);
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[1]!);
  });

  it("⚠️ o destino sai do BANCO, nunca do formulário", async () => {
    await sendWhatsAppMessageAction({ chatId: CHAT, body: "oi" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "5554991234567", body: "oi" }));
  });

  it("liquida com o id do fornecedor quando deu certo", async () => {
    await sendWhatsAppMessageAction({ chatId: CHAT, body: "oi" });

    expect(rpc).toHaveBeenLastCalledWith("whatsapp_settle_outbound_message", {
      p_message_id: MSG,
      p_provider_message_id: "WA-1",
      p_error: null,
    });
  });

  it("envio recusado vira falha COM o motivo, e a mensagem fica registrada", async () => {
    send.mockResolvedValue({
      ok: false,
      retryable: false,
      code: "zapi_http_400",
      message: "número não tem WhatsApp",
    });

    const resultado = await sendWhatsAppMessageAction({ chatId: CHAT, body: "oi" });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error.code).toBe("whatsappSendFailed");

    // A linha continua no banco, marcada como falha e com o motivo: é o que
    // permite descobrir três dias depois por que a resposta não chegou.
    expect(rpc).toHaveBeenLastCalledWith("whatsapp_settle_outbound_message", {
      p_message_id: MSG,
      p_provider_message_id: null,
      p_error: "número não tem WhatsApp",
    });
  });

  it("integração desligada recusa ANTES de gravar", async () => {
    // Uma mensagem "falhada" na conversa por falta de configuração faria
    // parecer que o problema é do associado, quando é do `.env`.
    configurado = false;

    const resultado = await sendWhatsAppMessageAction({ chatId: CHAT, body: "oi" });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error.code).toBe("whatsappNotConfigured");
    expect(rpc).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("mensagem vazia é barrada antes do banco", async () => {
    const resultado = await sendWhatsAppMessageAction({ chatId: CHAT, body: "   " });
    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("mensagem acima do limite do WhatsApp é barrada antes do banco", async () => {
    // 4096 é o teto de um texto no WhatsApp. Deixar passar faria o fornecedor
    // recusar DEPOIS do clique, em inglês, com o parágrafo já escrito.
    const resultado = await sendWhatsAppMessageAction({ chatId: CHAT, body: "a".repeat(4097) });
    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("id que não é uuid é barrado antes do banco", async () => {
    const resultado = await sendWhatsAppMessageAction({ chatId: "nao-e-uuid", body: "oi" });
    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("conversa inexistente não chega a mandar nada", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    const resultado = await sendWhatsAppMessageAction({ chatId: CHAT, body: "oi" });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error.code).toBe("notFound");
    expect(send).not.toHaveBeenCalled();
  });

  it("traduz o código do banco em vez de vazar a mensagem crua", async () => {
    rpc.mockImplementation(async (nome: string) =>
      nome === "whatsapp_start_outbound_message"
        ? {
            data: null,
            error: { code: "42501", message: 'permission denied for "whatsapp_messages"' },
          }
        : { data: null, error: null },
    );

    const resultado = await sendWhatsAppMessageAction({ chatId: CHAT, body: "oi" });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error.code).toBe("forbidden");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("arquivar e marcar como lida", () => {
  it("arquivar manda o valor pedido", async () => {
    await archiveWhatsAppChatAction({ chatId: CHAT, archived: true });
    expect(rpc).toHaveBeenCalledWith("whatsapp_set_chat_archived", {
      p_chat_id: CHAT,
      p_archived: true,
    });
  });

  it("desarquivar também", async () => {
    await archiveWhatsAppChatAction({ chatId: CHAT, archived: false });
    expect(rpc).toHaveBeenCalledWith("whatsapp_set_chat_archived", {
      p_chat_id: CHAT,
      p_archived: false,
    });
  });

  it("marcar como lida chama a função certa", async () => {
    await markWhatsAppChatReadAction(CHAT);
    expect(rpc).toHaveBeenCalledWith("whatsapp_mark_chat_read", { p_chat_id: CHAT });
  });

  it("id inválido é barrado antes do banco", async () => {
    expect((await markWhatsAppChatReadAction("abc")).ok).toBe(false);
    expect((await archiveWhatsAppChatAction({ chatId: "abc", archived: true })).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
