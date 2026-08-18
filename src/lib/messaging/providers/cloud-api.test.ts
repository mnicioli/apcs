import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudApiProvider, parseCloudApiWebhook } from "./cloud-api";

/**
 * §17, §26, §27, §29. O ADAPTADOR DA CLOUD API.
 *
 * ⚠️ Este código nunca rodou contra a API real — não há conta nem token neste
 * projeto (§95). O que estes testes provam é o contrato: como ele traduz
 * respostas e payloads que a documentação da Meta descreve. A validação contra
 * a API de verdade é o passo de homologação que depende da APCS.
 */

const ENV = {
  APCS_WHATSAPP_TOKEN: "token",
  APCS_WHATSAPP_PHONE_NUMBER_ID: "123456",
  APCS_WHATSAPP_APP_SECRET: "segredo",
  APCS_WHATSAPP_VERIFY_TOKEN: "verifica-me",
} as unknown as NodeJS.ProcessEnv;

function responder(status: number, corpo: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(corpo), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("send — sucesso", () => {
  it("devolve o id do fornecedor", async () => {
    vi.stubGlobal("fetch", responder(200, { messages: [{ id: "wamid.HBgN123" }] }));

    const r = await new CloudApiProvider(ENV).send({
      to: "5519991234567",
      body: "Olá",
      correlationId: "corr-1",
    });

    expect(r).toEqual({ ok: true, providerMessageId: "wamid.HBgN123" });
  });

  it("manda o corpo no formato da Cloud API, sem prévia de link", async () => {
    const fetchMock = responder(200, { messages: [{ id: "wamid.1" }] });
    vi.stubGlobal("fetch", fetchMock);

    await new CloudApiProvider(ENV).send({
      to: "5519991234567",
      body: "Pergunta",
      correlationId: "c",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/123456/messages");
    const corpo = JSON.parse(String(init.body));
    expect(corpo).toMatchObject({
      messaging_product: "whatsapp",
      to: "5519991234567",
      type: "text",
      // A prévia transformaria uma URL num cartão que rouba o espaço das
      // alternativas na tela do celular.
      text: { preview_url: false, body: "Pergunta" },
    });
  });

  it("⚠️ 200 SEM id de mensagem NÃO é sucesso", async () => {
    // §88: sem id não há como marcar "enviado" com honestidade — o webhook de
    // entrega chegaria citando um id que não teríamos guardado.
    vi.stubGlobal("fetch", responder(200, { messages: [] }));

    const r = await new CloudApiProvider(ENV).send({
      to: "5519991234567",
      body: "x",
      correlationId: "c",
    });

    expect(r).toMatchObject({ ok: false, code: "no_message_id", retryable: true });
  });
});

describe("send — falhas e a decisão de repetir (§19, §29)", () => {
  it("429 é temporário", async () => {
    vi.stubGlobal("fetch", responder(429, { error: { code: 80007, message: "rate limit" } }));
    const r = await new CloudApiProvider(ENV).send({ to: "55199", body: "x", correlationId: "c" });
    expect(r).toMatchObject({ ok: false, retryable: true });
  });

  it("500 é temporário", async () => {
    vi.stubGlobal("fetch", responder(503, {}));
    const r = await new CloudApiProvider(ENV).send({ to: "55199", body: "x", correlationId: "c" });
    expect(r).toMatchObject({ ok: false, retryable: true, code: "http_503" });
  });

  it("⚠️ 'não é usuário do WhatsApp' é DEFINITIVO", async () => {
    // Insistir num número que não existe queima cota de envio da conta para
    // sempre sem chance nenhuma de sucesso.
    vi.stubGlobal(
      "fetch",
      responder(400, { error: { code: 131026, message: "Receiver is incapable" } }),
    );
    const r = await new CloudApiProvider(ENV).send({ to: "55199", body: "x", correlationId: "c" });
    expect(r).toMatchObject({ ok: false, retryable: false, code: "wa_131026" });
  });

  it("parâmetro inválido é definitivo", async () => {
    vi.stubGlobal("fetch", responder(400, { error: { code: 100, message: "Invalid parameter" } }));
    const r = await new CloudApiProvider(ENV).send({ to: "x", body: "x", correlationId: "c" });
    expect(r).toMatchObject({ retryable: false });
  });

  it("erro de rede é temporário", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const r = await new CloudApiProvider(ENV).send({ to: "55199", body: "x", correlationId: "c" });
    expect(r).toMatchObject({ ok: false, retryable: true, code: "network" });
  });

  it("resposta ilegível não derruba o adaptador", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502 })),
    );
    const r = await new CloudApiProvider(ENV).send({ to: "55199", body: "x", correlationId: "c" });
    expect(r.ok).toBe(false);
  });
});

describe("verifyChallenge (§17)", () => {
  it("aceita o handshake com o token certo", () => {
    expect(new CloudApiProvider(ENV).verifyChallenge("subscribe", "verifica-me")).toBe(true);
  });

  it("recusa token errado, modo errado e vazio", () => {
    const p = new CloudApiProvider(ENV);
    expect(p.verifyChallenge("subscribe", "outro")).toBe(false);
    expect(p.verifyChallenge("unsubscribe", "verifica-me")).toBe(false);
    expect(p.verifyChallenge(null, null)).toBe(false);
    expect(p.verifyChallenge("subscribe", "")).toBe(false);
  });
});

describe("parseCloudApiWebhook — mensagens", () => {
  function envelope(value: unknown) {
    return {
      object: "whatsapp_business_account",
      entry: [{ id: "1", changes: [{ field: "messages", value }] }],
    };
  }

  it("lê uma resposta de texto", () => {
    const eventos = parseCloudApiWebhook(
      envelope({
        messages: [
          { id: "wamid.A", from: "5519991234567", timestamp: "1770000000", text: { body: "3" } },
        ],
      }),
    );

    expect(eventos).toEqual([
      {
        kind: "message",
        eventId: "wamid.A",
        from: "5519991234567",
        text: "3",
        replyToMessageId: null,
        timestamp: "1770000000",
      },
    ]);
  });

  it("⚠️ lê o id da mensagem CITADA — é a desambiguação do §9", () => {
    const eventos = parseCloudApiWebhook(
      envelope({
        messages: [
          {
            id: "wamid.B",
            from: "5519991234567",
            text: { body: "1" },
            context: { id: "wamid.PERGUNTA" },
          },
        ],
      }),
    );

    expect(eventos[0]).toMatchObject({ replyToMessageId: "wamid.PERGUNTA" });
  });

  it("áudio, imagem e figurinha são ignorados (§10: só texto no MVP)", () => {
    const eventos = parseCloudApiWebhook(
      envelope({
        messages: [
          { id: "wamid.C", from: "5519991234567", type: "audio", audio: { id: "x" } },
          { id: "wamid.D", from: "5519991234567", type: "image", image: { id: "y" } },
        ],
      }),
    );
    expect(eventos).toEqual([]);
  });

  it("mensagem sem id ou sem remetente é descartada", () => {
    const eventos = parseCloudApiWebhook(
      envelope({
        messages: [
          { from: "5519991234567", text: { body: "1" } },
          { id: "wamid.E", text: { body: "1" } },
        ],
      }),
    );
    expect(eventos).toEqual([]);
  });
});

describe("parseCloudApiWebhook — status (§26)", () => {
  function statusEnvelope(statuses: unknown[]) {
    return {
      object: "whatsapp_business_account",
      entry: [{ id: "1", changes: [{ field: "messages", value: { statuses } }] }],
    };
  }

  it("traduz sent, delivered e read", () => {
    const eventos = parseCloudApiWebhook(
      statusEnvelope([
        { id: "wamid.1", status: "sent", timestamp: "1" },
        { id: "wamid.1", status: "delivered", timestamp: "2" },
        { id: "wamid.1", status: "read", timestamp: "3" },
      ]),
    );

    expect(eventos.map((e) => e.kind === "status" && e.status)).toEqual([
      "sent",
      "delivered",
      "read",
    ]);
  });

  it("⚠️ A CHAVE DE IDEMPOTÊNCIA DE UM STATUS NÃO É O ID DA MENSAGEM", () => {
    // A mesma mensagem gera sent, delivered e read, todos com o MESMO `id`. Sem
    // o sufixo, o registro de idempotência aceitaria só o primeiro dos três — e
    // "entregue" e "lido" nunca seriam processados.
    const eventos = parseCloudApiWebhook(
      statusEnvelope([
        { id: "wamid.1", status: "sent" },
        { id: "wamid.1", status: "delivered" },
      ]),
    );

    const ids = eventos.map((e) => e.eventId);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(["wamid.1:sent", "wamid.1:delivered"]);
  });

  it("failed carrega o motivo do fornecedor (§27)", () => {
    const eventos = parseCloudApiWebhook(
      statusEnvelope([
        {
          id: "wamid.9",
          status: "failed",
          errors: [{ title: "Recipient not found", message: "número inexistente" }],
        },
      ]),
    );

    expect(eventos[0]).toMatchObject({
      kind: "status",
      status: "failed",
      errorMessage: "Recipient not found — número inexistente",
    });
  });

  it("status desconhecido é ignorado em silêncio", () => {
    expect(parseCloudApiWebhook(statusEnvelope([{ id: "w", status: "deleted" }]))).toEqual([]);
  });
});

describe("parseCloudApiWebhook — payload hostil (§18, §80)", () => {
  it("⚠️ NADA DISSO LANÇA — devolve lista vazia", () => {
    // O corpo vem da internet. A assinatura prova que veio da Meta, não que tem
    // o formato esperado — e uma versão nova da API muda o formato sem avisar.
    const entradas: unknown[] = [
      null,
      undefined,
      "texto",
      42,
      [],
      {},
      { object: "outra_coisa" },
      { object: "whatsapp_business_account", entry: "nao-e-array" },
      { object: "whatsapp_business_account", entry: [null] },
      { object: "whatsapp_business_account", entry: [{ changes: [{ value: null }] }] },
      { object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: 7 } }] }] },
      {
        object: "whatsapp_business_account",
        entry: [{ changes: [{ value: { messages: [{ id: 1, from: 2, text: 3 }] } }] }],
      },
    ];

    for (const entrada of entradas) {
      expect(() => parseCloudApiWebhook(entrada)).not.toThrow();
      expect(parseCloudApiWebhook(entrada)).toEqual([]);
    }
  });

  it("um payload de outro produto da Meta não vira evento de enquete", () => {
    expect(
      parseCloudApiWebhook({
        object: "page",
        entry: [{ messaging: [{ message: { text: "1" } }] }],
      }),
    ).toEqual([]);
  });
});
