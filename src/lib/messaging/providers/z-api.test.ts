import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZApiProvider, parseZApiWebhook, readZApiConfig } from "./z-api";

/**
 * O ADAPTADOR DA Z-API.
 *
 * ⚠️ ESTE ARQUIVO NUNCA FALOU COM A API REAL. Os payloads abaixo são cópias dos
 * exemplos da documentação oficial (developer.z-api.io, webhooks/*-examples e
 * message/send-text), e o `fetch` é dublê. O que ele prova é a TRADUÇÃO — que é
 * onde mora o risco, porque um campo lido errado não dá erro: dá uma caixa de
 * entrada com a informação errada e nenhum sintoma.
 *
 * Os três casos que mais importam estão aqui e valem por si:
 *
 *   • `momment` é epoch em MILISSEGUNDOS (a Meta usa segundos). Confundir joga
 *     a conversa inteira para 1970 ou para o ano 54000.
 *   • `ids` do status é um ARRAY. Ler `ids[0]` perderia confirmações em
 *     silêncio, e elas chegam agrupadas o tempo todo.
 *   • `verifySignature` SEMPRE recusa. É a trava que impede alguém apontar a
 *     rota genérica da Meta (que confia na assinatura) para este adaptador.
 */

const CONFIG = {
  APCS_ZAPI_INSTANCE_ID: "INST123",
  APCS_ZAPI_TOKEN: "TOK456",
  APCS_ZAPI_CLIENT_TOKEN: "CLIENT789",
  APCS_ZAPI_WEBHOOK_SECRET: "segredo-do-webhook",
} as unknown as NodeJS.ProcessEnv;

/** O exemplo de mensagem de texto da documentação, campo por campo. */
function textoRecebido(extra: Record<string, unknown> = {}) {
  return {
    isStatusReply: false,
    connectedPhone: "554499999999",
    waitingMessage: false,
    isEdit: false,
    isGroup: false,
    isNewsletter: false,
    instanceId: "A20DA9C0183A2D35A260F53F5D2B9244",
    messageId: "3EB0C767D097B7C7C030",
    phone: "5544999999999",
    fromMe: false,
    momment: 1632228638000,
    status: "RECEIVED",
    chatName: "João Suinocultor",
    senderPhoto: "https://exemplo.invalid/foto.jpg",
    senderName: "João Suinocultor",
    participantPhone: null,
    photo: "https://exemplo.invalid/foto.jpg",
    broadcast: false,
    type: "ReceivedCallback",
    text: { message: "Bom dia, preciso do boletim" },
    ...extra,
  };
}

describe("readZApiConfig", () => {
  it("com as quatro variáveis, configura", () => {
    const { config, missing } = readZApiConfig(CONFIG);
    expect(config).not.toBeNull();
    expect(missing).toEqual([]);
  });

  it("lista o que falta, pelo nome da variável", () => {
    const { config, missing } = readZApiConfig({
      APCS_ZAPI_INSTANCE_ID: "INST123",
    } as unknown as NodeJS.ProcessEnv);

    expect(config).toBeNull();
    expect(missing).toEqual([
      "APCS_ZAPI_TOKEN",
      "APCS_ZAPI_CLIENT_TOKEN",
      "APCS_ZAPI_WEBHOOK_SECRET",
    ]);
  });
});

describe("a assinatura que não existe", () => {
  it("⚠️ verifySignature SEMPRE recusa, e explica por quê", () => {
    const p = new ZApiProvider(CONFIG);
    const check = p.verifySignature("{}", new Headers());

    expect(check.valid).toBe(false);
    expect(check.reason).toContain("não assina");
  });

  it("o segredo da URL é o que autentica", () => {
    const p = new ZApiProvider(CONFIG);
    expect(p.verifyWebhookSecret("segredo-do-webhook")).toBe(true);
    expect(p.verifyWebhookSecret("segredo-do-webhookX")).toBe(false);
    expect(p.verifyWebhookSecret("outro")).toBe(false);
    expect(p.verifyWebhookSecret("")).toBe(false);
    expect(p.verifyWebhookSecret(null)).toBe(false);
  });

  it("sem configuração, nenhum segredo passa", () => {
    const p = new ZApiProvider({} as unknown as NodeJS.ProcessEnv);
    expect(p.verifyWebhookSecret("qualquer")).toBe(false);
    // Nem o vazio, que é o que chegaria se alguém deixasse a variável em branco
    // e cadastrasse a URL sem o último segmento.
    expect(p.verifyWebhookSecret("")).toBe(false);
  });
});

describe("parseZApiWebhook — mensagem recebida", () => {
  it("traduz um texto com tudo que a conversa precisa", () => {
    const [evento] = parseZApiWebhook(textoRecebido());

    expect(evento).toEqual({
      kind: "message",
      eventId: "3EB0C767D097B7C7C030",
      from: "5544999999999",
      text: "Bom dia, preciso do boletim",
      replyToMessageId: null,
      timestamp: new Date(1632228638000).toISOString(),
      conversation: {
        fromMe: false,
        isGroup: false,
        chatName: "João Suinocultor",
        senderName: "João Suinocultor",
        photoUrl: "https://exemplo.invalid/foto.jpg",
        participantPhone: null,
      },
      media: null,
    });
  });

  it("⚠️ `momment` é epoch em MILISSEGUNDOS, não em segundos", () => {
    const [evento] = parseZApiWebhook(textoRecebido({ momment: 1632228638000 }));
    // 1632228638000 ms = 21/09/2021. Lido como segundos daria o ano 53680.
    expect(evento?.timestamp?.slice(0, 4)).toBe("2021");
  });

  it("carimbo ausente ou zerado vira nulo, e não 1970", () => {
    expect(parseZApiWebhook(textoRecebido({ momment: 0 }))[0]?.timestamp).toBeNull();
    expect(parseZApiWebhook(textoRecebido({ momment: undefined }))[0]?.timestamp).toBeNull();
  });

  it("guarda o `fromMe` — é o que distingue nossa mensagem da dela", () => {
    const [evento] = parseZApiWebhook(textoRecebido({ fromMe: true }));
    expect(evento?.kind === "message" && evento.conversation?.fromMe).toBe(true);
  });

  it("em grupo, guarda quem falou", () => {
    const [evento] = parseZApiWebhook(
      textoRecebido({ isGroup: true, participantPhone: "5554991110001", chatName: "Núcleo Serra" }),
    );

    expect(evento?.kind === "message" && evento.conversation).toMatchObject({
      isGroup: true,
      participantPhone: "5554991110001",
      chatName: "Núcleo Serra",
    });
  });

  it("guarda o id da mensagem citada", () => {
    const [evento] = parseZApiWebhook(textoRecebido({ referenceMessageId: "3EB0CITADA" }));
    expect(evento?.kind === "message" && evento.replyToMessageId).toBe("3EB0CITADA");
  });

  it("canal (newsletter) é ignorado: não é conversa e ninguém responde a um", () => {
    expect(parseZApiWebhook(textoRecebido({ isNewsletter: true }))).toEqual([]);
  });

  it("sem messageId ou sem phone, ignora", () => {
    expect(parseZApiWebhook(textoRecebido({ messageId: undefined }))).toEqual([]);
    expect(parseZApiWebhook(textoRecebido({ phone: undefined }))).toEqual([]);
  });

  it("texto vazio não vira mensagem", () => {
    expect(parseZApiWebhook(textoRecebido({ text: { message: "" } }))).toEqual([]);
  });
});

describe("parseZApiWebhook — anexos", () => {
  it("imagem com legenda: a legenda vira o texto, a URL vira o anexo", () => {
    const [evento] = parseZApiWebhook(
      textoRecebido({
        text: undefined,
        image: {
          mimeType: "image/jpeg",
          imageUrl: "https://exemplo.invalid/foto.jpg",
          caption: "Olha a leitoa",
          width: 600,
          height: 315,
        },
      }),
    );

    expect(evento?.kind === "message" && evento.text).toBe("Olha a leitoa");
    expect(evento?.kind === "message" && evento.media).toEqual({
      kind: "image",
      url: "https://exemplo.invalid/foto.jpg",
      mimeType: "image/jpeg",
      fileName: null,
      durationSeconds: null,
    });
  });

  it("áudio guarda a duração", () => {
    const [evento] = parseZApiWebhook(
      textoRecebido({
        text: undefined,
        audio: {
          ptt: true,
          seconds: 67,
          audioUrl: "https://exemplo.invalid/audio.ogg",
          mimeType: "audio/ogg; codecs=opus",
        },
      }),
    );

    expect(evento?.kind === "message" && evento.media).toMatchObject({
      kind: "audio",
      durationSeconds: 67,
    });
  });

  it("documento guarda o nome do arquivo", () => {
    const [evento] = parseZApiWebhook(
      textoRecebido({
        text: undefined,
        document: {
          documentUrl: "https://exemplo.invalid/nota.pdf",
          mimeType: "application/pdf",
          fileName: "nota-fiscal.pdf",
          title: "nota",
        },
      }),
    );

    expect(evento?.kind === "message" && evento.media).toMatchObject({
      kind: "document",
      fileName: "nota-fiscal.pdf",
    });
  });

  it("⚠️ anexo SEM url (a Z-API não conseguiu baixar) ainda vira mensagem", () => {
    // Sem este caminho a mensagem sumiria da conversa — e o atendente
    // responderia a uma foto que ele acha que nunca chegou.
    const [evento] = parseZApiWebhook(
      textoRecebido({
        text: undefined,
        image: { mimeType: "image/jpeg", downloadError: "falhou", caption: "segue a foto" },
      }),
    );

    expect(evento?.kind === "message" && evento.text).toBe("segue a foto");
    expect(evento?.kind === "message" && evento.media).toBeNull();
  });

  it("localização vira o endereço", () => {
    const [evento] = parseZApiWebhook(
      textoRecebido({
        text: undefined,
        location: { latitude: -29.16, longitude: -51.17, address: "Caxias do Sul, RS" },
      }),
    );
    expect(evento?.kind === "message" && evento.text).toBe("Caxias do Sul, RS");
  });

  it("localização sem endereço cai nas coordenadas, e não em branco", () => {
    const [evento] = parseZApiWebhook(
      textoRecebido({ text: undefined, location: { latitude: -29.16, longitude: -51.17 } }),
    );
    expect(evento?.kind === "message" && evento.text).toBe("-29.16, -51.17");
  });

  it("contato vira nome e telefone", () => {
    const [evento] = parseZApiWebhook(
      textoRecebido({
        text: undefined,
        contact: { displayName: "Cesar Baleco", phones: ["5544999999999"] },
      }),
    );
    expect(evento?.kind === "message" && evento.text).toBe("Cesar Baleco — 5544999999999");
  });

  it("tipo desconhecido vira mensagem SEM texto, para a conversa não ter buraco", () => {
    const [evento] = parseZApiWebhook(textoRecebido({ text: undefined, poll: { question: "?" } }));
    expect(evento?.kind === "message" && evento.text).toBe("");
    expect(evento?.kind === "message" && evento.media).toBeNull();
  });
});

describe("parseZApiWebhook — entrega e leitura", () => {
  function status(extra: Record<string, unknown> = {}) {
    return {
      instanceId: "INST",
      status: "READ",
      ids: ["3EB0A", "3EB0B"],
      momment: 1632234645000,
      phoneDevice: 0,
      phone: "5544999999999",
      type: "MessageStatusCallback",
      isGroup: false,
      ...extra,
    };
  }

  it("⚠️ `ids` é um ARRAY: gera um evento por id", () => {
    const eventos = parseZApiWebhook(status());
    expect(eventos).toHaveLength(2);
    expect(eventos.map((e) => e.kind === "status" && e.providerMessageId)).toEqual([
      "3EB0A",
      "3EB0B",
    ]);
  });

  it("a chave de idempotência inclui o status, senão só o primeiro dos três valeria", () => {
    const enviada = parseZApiWebhook(status({ status: "SENT", ids: ["X"] }));
    const entregue = parseZApiWebhook(status({ status: "RECEIVED", ids: ["X"] }));
    const lida = parseZApiWebhook(status({ status: "READ", ids: ["X"] }));

    expect([enviada[0]?.eventId, entregue[0]?.eventId, lida[0]?.eventId]).toEqual([
      "X:sent",
      "X:delivered",
      "X:read",
    ]);
  });

  it("traduz a escala da Z-API para a da porta", () => {
    const traduz = (s: string) => {
      const [e] = parseZApiWebhook(status({ status: s, ids: ["X"] }));
      return e?.kind === "status" ? e.status : null;
    };

    // "RECEIVED" da Z-API é "chegou no aparelho" — `delivered` no vocabulário
    // da porta. Traduzi-lo como "received" confundiria com a mensagem recebida.
    expect(traduz("RECEIVED")).toBe("delivered");
    expect(traduz("SENT")).toBe("sent");
    expect(traduz("READ")).toBe("read");
    expect(traduz("PLAYED")).toBe("read");
  });

  it('⚠️ "READ_BY_ME" é NÓS lendo, não ela — é ignorado', () => {
    // Traduzi-lo marcaria como lida a mensagem errada: a que a PESSOA mandou.
    expect(parseZApiWebhook(status({ status: "READ_BY_ME" }))).toEqual([]);
  });

  it("status desconhecido é ignorado em silêncio", () => {
    expect(parseZApiWebhook(status({ status: "DELETED" }))).toEqual([]);
  });

  it("o DeliveryCallback confirma que a mensagem saiu", () => {
    const eventos = parseZApiWebhook({
      phone: "554499999999",
      zaapId: "ZAAP1",
      messageId: "WA1",
      instanceId: "INST",
      momment: 1777494009341,
      type: "DeliveryCallback",
    });

    expect(eventos).toEqual([
      {
        kind: "status",
        eventId: "WA1:sent",
        providerMessageId: "WA1",
        status: "sent",
        errorMessage: null,
        timestamp: new Date(1777494009341).toISOString(),
      },
    ]);
  });
});

describe("parseZApiWebhook — o que não é evento", () => {
  it("ignora tipo desconhecido, nulo e lixo", () => {
    for (const entrada of [
      null,
      undefined,
      "texto",
      [],
      {},
      { type: "DisconnectedCallback" },
      { type: "ConnectedCallback" },
    ]) {
      expect(parseZApiWebhook(entrada)).toEqual([]);
    }
  });
});

describe("send", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function resposta(status: number, corpo: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => corpo,
      headers: new Headers(),
    } as unknown as Response;
  }

  it("monta a URL com instância e token, e manda o Client-Token no header", async () => {
    fetchMock.mockResolvedValue(resposta(200, { zaapId: "Z1", messageId: "WA1", id: "WA1" }));

    const p = new ZApiProvider(CONFIG);
    await p.send({ to: "5554991234567", body: "oi", correlationId: "c1" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.z-api.io/instances/INST123/token/TOK456/send-text");
    expect((init.headers as Record<string, string>)["Client-Token"]).toBe("CLIENT789");
    expect(JSON.parse(init.body as string)).toEqual({ phone: "5554991234567", message: "oi" });
  });

  it("⚠️ devolve o `messageId` do WhatsApp, e NÃO o `zaapId`", async () => {
    // Os webhooks de status citam o id do WhatsApp em `ids`. Guardar o `zaapId`
    // faria toda confirmação de entrega cair em "esta mensagem não é nossa".
    fetchMock.mockResolvedValue(resposta(200, { zaapId: "ZAAP", messageId: "WA1", id: "WA1" }));

    const r = await new ZApiProvider(CONFIG).send({
      to: "5554991234567",
      body: "oi",
      correlationId: "c1",
    });
    expect(r).toEqual({ ok: true, providerMessageId: "WA1" });
  });

  it("aceitou sem devolver id é FALHA, e não sucesso", async () => {
    fetchMock.mockResolvedValue(resposta(200, { ok: true }));

    const r = await new ZApiProvider(CONFIG).send({
      to: "5554991234567",
      body: "oi",
      correlationId: "c1",
    });
    expect(r).toMatchObject({ ok: false, retryable: true, code: "no_message_id" });
  });

  it("429 e 5xx são para tentar de novo; 4xx não", async () => {
    const p = new ZApiProvider(CONFIG);

    fetchMock.mockResolvedValue(resposta(429, { error: "rate" }));
    expect(await p.send({ to: "1", body: "a", correlationId: "c" })).toMatchObject({
      retryable: true,
    });

    fetchMock.mockResolvedValue(resposta(503, { error: "down" }));
    expect(await p.send({ to: "1", body: "a", correlationId: "c" })).toMatchObject({
      retryable: true,
    });

    // Token errado: repetir não conserta o token, só enche a tabela de erro.
    fetchMock.mockResolvedValue(resposta(401, { error: "invalid token" }));
    expect(await p.send({ to: "1", body: "a", correlationId: "c" })).toMatchObject({
      retryable: false,
      code: "zapi_http_401",
      message: "invalid token",
    });
  });

  /**
   * ⚠️ TIMEOUT NÃO É "NÃO ENVIOU", É "NÃO SEI" — e por isso saiu da repetição.
   *
   * O pedido chegou inteiro à Z-API; o que faltou foi a resposta. No envio de
   * imagem isso é o caso COMUM, porque quem baixa o cartaz é o servidor dela e
   * é essa busca que estoura os 30 segundos. Repetir manda a mesma divulgação
   * duas ou três vezes para a mesma pessoa — e é assim que um número passa a
   * ser bloqueado por muita gente.
   */
  it("timeout NÃO é para tentar de novo, e a mensagem diz por quê", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    const promessa = new ZApiProvider(CONFIG).send({ to: "1", body: "a", correlationId: "c" });
    await vi.advanceTimersByTimeAsync(20_000);
    const r = await promessa;

    expect(r).toMatchObject({ ok: false, retryable: false, code: "timeout" });
    if (!r.ok) expect(r.message).toMatch(/PODE ter sido entregue/);

    vi.useRealTimers();
  });

  it("queda de rede é sempre retryable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));

    const r = await new ZApiProvider(CONFIG).send({ to: "1", body: "a", correlationId: "c" });
    expect(r).toMatchObject({ ok: false, retryable: true, code: "network" });
  });

  it("não configurado recusa alto, dizendo o que falta", async () => {
    const p = new ZApiProvider({} as unknown as NodeJS.ProcessEnv);
    const r = await p.send({ to: "1", body: "a", correlationId: "c" });

    expect(r).toMatchObject({ ok: false, retryable: false, code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
