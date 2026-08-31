import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeProvider } from "@/lib/messaging/providers/fake";
import type * as Resilience from "@/lib/messaging/resilience";
import type { BotChatTarget } from "@/lib/services/whatsapp-bot";
import type { BotReply } from "./engine";

/**
 * §13, §14, §32, §42, §54, §61. A ENTREGA — do `BotReply` ao WhatsApp.
 *
 * ⚠️ ESTES TESTES MEDEM O QUE SAIU, E EM QUE ORDEM. É a metade que dá defeito
 * silencioso: um envio que manda o PDF antes da imagem, ou que manda para o
 * número errado, funciona perfeitamente do ponto de vista de qualquer
 * asserção que só conte mensagens.
 *
 * `FakeProvider.outbox` existe exatamente para isso — os três tipos numa lista
 * só, na ordem real. Com `sentImages` e `sentDocuments` separados, um envio
 * invertido passaria em tudo.
 */

/** O livro-razão, em memória. */
const razao = {
  gravadas: [] as { id: string; chatId: string; body: string; kind: string }[],
  liquidadas: [] as { messageId: string; providerMessageId: string | null; erro: string | null }[],
  /** Quando `false`, `startBotMessage` devolve `null` (falha ao gravar). */
  gravaOk: true,
  sequencia: 0,
};

vi.mock("@/lib/services/whatsapp-bot", () => ({
  startBotMessage: vi.fn(async (chatId: string, body: string, kind: string) => {
    if (!razao.gravaOk) return null;
    razao.sequencia += 1;
    const id = `msg-${razao.sequencia}`;
    razao.gravadas.push({ id, chatId, body, kind });
    return id;
  }),
  settleBotMessage: vi.fn(
    async (messageId: string, providerMessageId: string | null, erro: string | null) => {
      razao.liquidadas.push({ messageId, providerMessageId, erro });
    },
  ),
}));

/**
 * ⚠️ O BACKOFF VIRA ZERO, e só ele. `MAX_SEND_ATTEMPTS` continua o de verdade —
 * é ele que este arquivo mede. Sem o corte, cada teste de retry esperaria até
 * três segundos de jitter real e a bateria ficaria lenta por nada.
 */
vi.mock("@/lib/messaging/resilience", async (original) => {
  const real = await original<typeof Resilience>();
  return { ...real, backoffDelayMs: () => 0 };
});

const { deliverBotReply, montarPecas } = await import("./deliver");

const ANA: BotChatTarget = {
  chatId: "chat-ana",
  chatKey: "5519991110001",
  phone: "5519991110001",
  contactId: null,
  memberId: null,
};

const BRUNO: BotChatTarget = {
  chatId: "chat-bruno",
  chatKey: "5519992220002",
  phone: "5519992220002",
  contactId: null,
  memberId: null,
};

function resposta(over: Partial<BotReply> = {}): BotReply {
  return {
    body: "Esta é a publicação vigente da Bolsa de Suínos.",
    attachments: [],
    handoff: false,
    source: null,
    interactionId: 1,
    intent: "consultar_bolsa",
    tool: "getActiveBolsa",
    outcome: "tool_ok",
    ...over,
  };
}

const BOLSA = resposta({
  attachments: [
    { kind: "image", url: "https://storage/bolsa.png" },
    { kind: "document", url: "https://storage/bolsa.pdf", fileName: "Bolsa_12Ago26.pdf" },
  ],
});

beforeEach(() => {
  razao.gravadas = [];
  razao.liquidadas = [];
  razao.gravaOk = true;
  vi.clearAllMocks();
});

async function entregar(reply: BotReply, target = ANA, provider = new FakeProvider()) {
  const outcome = await deliverBotReply({
    target,
    reply,
    provider,
    correlationId: "corr-teste",
  });
  return { outcome, provider };
}

describe("§14. A legenda vai DENTRO do anexo", () => {
  it("sem anexo, é uma mensagem de texto", () => {
    expect(montarPecas(resposta({ body: "Olá!" }))).toEqual([
      { kind: "text", body: "Olá!", url: null, fileName: null },
    ]);
  });

  /**
   * ⚠️ ESTE É O DESVIO DELIBERADO DO §14, e o teste existe para fixá-lo.
   *
   * O §14 pede três mensagens (texto, imagem, PDF). Aqui são duas: a explicação
   * é a legenda da imagem. A razão está em `messaging.types.ts` e é anterior a
   * este módulo — dois balões separados podem chegar fora de ordem, e a pessoa
   * veria o cartaz sem explicação.
   *
   * Se alguém "corrigir" isto para seguir o §14 ao pé da letra, é aqui que a
   * conversa acontece.
   */
  it("com anexo, NÃO existe mensagem de texto separada", () => {
    const pecas = montarPecas(BOLSA);

    expect(pecas.map((p) => p.kind)).toEqual(["image", "document"]);
    expect(pecas[0]?.body).toBe("Esta é a publicação vigente da Bolsa de Suínos.");
  });

  it("o segundo anexo leva o nome do arquivo, e não a explicação repetida", () => {
    // Repetir a legenda faria a pessoa ler a mesma frase duas vezes seguidas; o
    // nome do arquivo é o que ela vai procurar seis meses depois.
    expect(montarPecas(BOLSA)[1]?.body).toBe("Bolsa_12Ago26.pdf");
  });

  it("nenhuma peça sai com corpo vazio", () => {
    // `whatsapp_start_bot_message` recusa corpo em branco. Uma peça vazia aqui
    // pararia o envio inteiro por causa de um rótulo.
    const semNada = montarPecas(
      resposta({ body: "   ", attachments: [{ kind: "document", url: "https://x/y.pdf" }] }),
    );

    expect(semNada[0]?.body.trim()).not.toBe("");
  });

  it("resposta sem corpo e sem anexo não vira mensagem nenhuma", () => {
    expect(montarPecas(resposta({ body: "" }))).toEqual([]);
  });
});

describe("§13. Imagem e PDF, nessa ordem", () => {
  it("a imagem sai ANTES do PDF", async () => {
    const { provider } = await entregar(BOLSA);

    expect(provider.outbox.map((m) => m.kind)).toEqual(["image", "document"]);
  });

  it("os dois vão com a URL assinada que a porta do CRM devolveu", async () => {
    const { provider } = await entregar(BOLSA);

    expect(provider.sentImages[0]?.imageUrl).toBe("https://storage/bolsa.png");
    expect(provider.sentDocuments[0]?.documentUrl).toBe("https://storage/bolsa.pdf");
    // §33. O nome viaja junto: sem ele a Z-API entrega "documento.pdf", e quem
    // recebe cinco boletins por ano fica com cinco arquivos de nome igual.
    expect(provider.sentDocuments[0]?.fileName).toBe("Bolsa_12Ago26.pdf");
  });

  it("o histórico do CRM guarda a MESMA legenda que a pessoa recebeu", async () => {
    const { provider } = await entregar(BOLSA);

    expect(razao.gravadas.map((g) => g.body)).toEqual(provider.outbox.map((m) => m.caption));
    expect(razao.gravadas.map((g) => g.kind)).toEqual(["image", "document"]);
  });

  it("conta os anexos que saíram — é o MEDIA_SENT do §48", async () => {
    const { outcome } = await entregar(BOLSA);

    expect(outcome.attachmentsSent).toBe(2);
    expect(outcome.sent).toBe(2);
    expect(outcome.failed).toBe(false);
  });
});

describe("§32 e §61. O destinatário", () => {
  it("tudo vai para o número da conversa que perguntou", async () => {
    const { provider } = await entregar(BOLSA);

    expect(new Set(provider.outbox.map((m) => m.to))).toEqual(new Set([ANA.chatKey]));
  });

  /**
   * ⚠️ §61. O teste que prova que dois associados não se cruzam.
   *
   * O risco real não é teórico: se o destino viesse de uma variável de módulo,
   * de um cache ou do `from` do payload, duas mensagens processadas no mesmo
   * lote poderiam sair para o mesmo número — e uma pessoa receberia o PDF que
   * outra pediu.
   */
  it("a Bolsa de Ana vai para Ana e a de Bruno para Bruno", async () => {
    const provider = new FakeProvider();

    await entregar(BOLSA, ANA, provider);
    await entregar(BOLSA, BRUNO, provider);

    const destinos = provider.outbox.map((m) => m.to);
    expect(destinos.slice(0, 2)).toEqual([ANA.chatKey, ANA.chatKey]);
    expect(destinos.slice(2)).toEqual([BRUNO.chatKey, BRUNO.chatKey]);
  });
});

describe("§42. Tentar de novo", () => {
  it("falha temporária é retentada e a mensagem sai", async () => {
    const provider = new FakeProvider().failTemporarily(ANA.chatKey, 1);

    const { outcome } = await entregar(resposta({ body: "Olá!" }), ANA, provider);

    expect(outcome.sent).toBe(1);
    expect(provider.sent).toHaveLength(1);
    // Uma linha só no razão: o retry é do ENVIO, não da mensagem.
    expect(razao.gravadas).toHaveLength(1);
  });

  /**
   * ⚠️ DUAS TENTATIVAS, E NÃO AS TRÊS DAS CAMPANHAS — ver `MAX_BOT_SEND_ATTEMPTS`.
   *
   * O teto não é preferência: três tentativas estourando o timeout de 15 s são
   * 45 s, e a rota do webhook tem `maxDuration = 60`. A função seria morta pela
   * plataforma no meio do envio, deixando a mensagem presa em `pending` sem
   * ninguém para curá-la.
   *
   * Este teste fixa o número. Se alguém o subir para 3 "por consistência com as
   * campanhas", é aqui que a conversa acontece.
   */
  it("desiste na segunda tentativa — o prazo da rota não comporta a terceira", async () => {
    const provider = new FakeProvider().failTemporarily(ANA.chatKey, 2);

    const { outcome } = await entregar(resposta({ body: "Olá!" }), ANA, provider);

    expect(outcome.failed).toBe(true);
    expect(provider.sent).toHaveLength(0);
  });

  /**
   * ⚠️ "ESTE NÚMERO NÃO TEM WHATSAPP" NÃO SE RETENTA. Insistir queima a cota de
   * envio da conta sem nenhuma chance de sucesso — a distinção vem do
   * adaptador, no `retryable` do `SendResult`.
   */
  it("falha definitiva não é retentada", async () => {
    const provider = new FakeProvider().rejectPermanently(ANA.chatKey);

    const { outcome } = await entregar(resposta({ body: "Olá!" }), ANA, provider);

    expect(outcome.failed).toBe(true);
    expect(provider.sent).toHaveLength(0);
  });

  it("esgotadas as tentativas, desiste em vez de insistir para sempre", async () => {
    const provider = new FakeProvider().failTemporarily(ANA.chatKey, 99);

    const { outcome } = await entregar(resposta({ body: "Olá!" }), ANA, provider);

    expect(outcome.failed).toBe(true);
    expect(outcome.sent).toBe(0);
  });
});

describe("§54. Quando o envio falha", () => {
  it("a mensagem fica no histórico marcada como falha, e não some", async () => {
    const provider = new FakeProvider().rejectPermanently(ANA.chatKey);

    await entregar(resposta({ body: "Olá!" }), ANA, provider);

    // GRAVA PENDENTE → MANDA → LIQUIDA. A linha existe, com o erro do
    // fornecedor. É o que faz o atendente ver que houve tentativa.
    expect(razao.gravadas).toHaveLength(1);
    expect(razao.liquidadas[0]?.providerMessageId).toBeNull();
    expect(razao.liquidadas[0]?.erro).toBeTruthy();
  });

  /**
   * ⚠️ O PDF NÃO SAI SOZINHO. Se a imagem com a explicação não foi, mandar só o
   * documento entrega um arquivo sem nenhum contexto — a pessoa recebe um PDF
   * do nada. Melhor uma resposta faltando por inteiro, visível como falha na
   * caixa de entrada, do que meia resposta que parece completa.
   */
  it("falha no primeiro anexo interrompe o resto", async () => {
    const provider = new FakeProvider().rejectPermanently(ANA.chatKey);

    const { outcome } = await entregar(BOLSA, ANA, provider);

    expect(provider.outbox).toHaveLength(0);
    expect(razao.gravadas).toHaveLength(1);
    expect(outcome.attachmentsSent).toBe(0);
  });

  /**
   * ⚠️ NÃO ENVIA SEM REGISTRO. Uma mensagem que a pessoa recebe e que não existe
   * no CRM é invisível — e o atendente a repetiria, achando que nunca saiu.
   */
  it("se o histórico não gravou, nada é enviado", async () => {
    razao.gravaOk = false;
    const provider = new FakeProvider();

    const { outcome } = await entregar(BOLSA, ANA, provider);

    expect(provider.outbox).toHaveLength(0);
    expect(outcome.failed).toBe(true);
    expect(outcome.firstMessageId).toBeNull();
  });
});

describe("§46. A ponta final da rastreabilidade", () => {
  it("devolve a PRIMEIRA mensagem enviada", async () => {
    const { outcome } = await entregar(BOLSA);

    // A relação, e não um id literal: é ela que o §46 promete.
    expect(razao.gravadas).toHaveLength(2);
    expect(outcome.firstMessageId).toBe(razao.gravadas[0]?.id);
    expect(outcome.firstMessageId).not.toBe(razao.gravadas[1]?.id);
  });
});
