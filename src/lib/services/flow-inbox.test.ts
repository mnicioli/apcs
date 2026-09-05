import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeProvider } from "@/lib/messaging/providers/fake";
import { UnconfiguredProvider } from "@/lib/messaging/providers/unconfigured";
import type { FlowTurnOutcome } from "@/lib/flow/runtime";
import type { MessagingProvider } from "@/lib/messaging/messaging.types";
import type { RecordedMessage } from "./whatsapp-inbox";

/**
 * §4, §6 E §39 DO PROMPT 4 — o lugar do fluxo na fila do webhook.
 *
 * ============================================================================
 * ⚠️ ESTA BATERIA É SOBRE `handled`, E NÃO SOBRE O ATENDIMENTO.
 * ============================================================================
 *
 * O que o motor responde já é testado em `flow.engine.*`. O que este arquivo
 * prova é a única coisa que só existe AQUI: quais mensagens este consumidor
 * TIRA do robô de um turno, e quais ele deixa passar.
 *
 * Errar isso não dá erro em lugar nenhum. Marcar de menos faz os dois
 * responderem à mesma pergunta, e o associado recebe duas respostas diferentes
 * no mesmo segundo. Marcar de mais mata o atendimento de quem não estava em
 * fluxo nenhum — e o sintoma é silêncio, que ninguém percebe.
 */

const CHAT = "ccccccc1-0000-4000-8000-000000000001";
const NUMERO = "5519991234567";

const estado = {
  /** O que `whatsapp_bot_should_answer` responde. */
  podeFalar: true,
  /** §39 do módulo de inteligência. */
  dentroDoLimite: true,
  /** §83. A chave geral, compartilhada com o robô de um turno. */
  ligado: true,
  /** O que o motor devolve. É o que decide `handled`. */
  desfecho: { kind: "advanced", runId: "r1", sent: 1, failed: 0 } as FlowTurnOutcome,
  /** Se o motor deve explodir, para o caminho do `catch`. */
  explode: false,
  /** As chamadas ao motor — é o que prova que ele NÃO foi chamado. */
  turnos: [] as { chatId: string; text: string; idempotencyKey: string }[],
};

vi.mock("./whatsapp-bot", () => ({
  botShouldAnswer: vi.fn(async () => estado.podeFalar),
  botWithinRateLimit: vi.fn(async () => estado.dentroDoLimite),
}));

vi.mock("@/lib/intelligence/flags", () => ({
  chatbotEnabled: vi.fn(async () => estado.ligado),
}));

vi.mock("@/lib/flow/runtime", () => ({
  handleInboundFlowMessage: vi.fn(
    async (input: { chatId: string; text: string; idempotencyKey: string }) => {
      estado.turnos.push({
        chatId: input.chatId,
        text: input.text,
        idempotencyKey: input.idempotencyKey,
      });
      if (estado.explode) throw new Error("banco fora do ar");
      return estado.desfecho;
    },
  ),
}));

const { processFlowMessages } = await import("./flow-inbox");

function mensagem(parcial: Partial<RecordedMessage> = {}): RecordedMessage {
  return {
    eventId: "evt-1",
    messageId: "msg-1",
    chatId: CHAT,
    duplicate: false,
    fromMe: false,
    isGroup: false,
    text: "quero saber o valor do suíno",
    phone: NUMERO,
    ...parcial,
  };
}

function provider(): MessagingProvider {
  return new FakeProvider();
}

beforeEach(() => {
  estado.podeFalar = true;
  estado.dentroDoLimite = true;
  estado.ligado = true;
  estado.desfecho = { kind: "advanced", runId: "r1", sent: 1, failed: 0 };
  estado.explode = false;
  estado.turnos = [];
  vi.clearAllMocks();
});

/* -------------------------------------------------------------------------- */
/* A propriedade que torna a mudança segura                                   */
/* -------------------------------------------------------------------------- */

describe("sem fluxo publicado", () => {
  /**
   * ============================================================================
   * ⚠️ O TESTE MAIS IMPORTANTE DESTE ARQUIVO.
   * ============================================================================
   *
   * Toda instalação da APCS começa sem fluxo de entrada publicado, e nesse
   * estado o Flow Engine tem de ser INVISÍVEL: a mensagem segue inteira para o
   * robô de um turno, como seguia antes de o Prompt 4 existir.
   *
   * Se este teste falhar, ligar os fluxos passou a QUEBRAR o atendimento que já
   * funcionava — e o sintoma seria mensagens sem resposta, que ninguém percebe.
   */
  it("não marca nada como tratado, e o robô recebe tudo", async () => {
    estado.desfecho = { kind: "no_flow" };

    const resultado = await processFlowMessages([mensagem()], new Set(), provider(), "corr");

    expect(resultado.handled).toEqual([]);
    expect(resultado.skipped).toBe(1);
    expect(resultado.advanced).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* §6 — a conversa continua de onde parou                                     */
/* -------------------------------------------------------------------------- */

describe("com fluxo em andamento", () => {
  it("tira a mensagem do robô quando o fluxo avançou", async () => {
    const resultado = await processFlowMessages([mensagem()], new Set(), provider(), "corr");

    expect(resultado.handled).toEqual(["evt-1"]);
    expect(resultado.advanced).toBe(1);
    expect(estado.turnos).toHaveLength(1);
  });

  /** §23. A chave de idempotência é o id do EVENTO, que é o que é reentregue. */
  it("usa o id do evento como chave de idempotência", async () => {
    await processFlowMessages(
      [mensagem({ eventId: "evt-99", messageId: "msg-77" })],
      new Set(),
      provider(),
      "corr",
    );

    expect(estado.turnos[0]?.idempotencyKey).toBe("evt-99");
  });

  it("corta o texto antes de entregá-lo ao motor", async () => {
    await processFlowMessages(
      [mensagem({ text: "a".repeat(5000) })],
      new Set(),
      provider(),
      "corr",
    );

    expect(estado.turnos[0]?.text.length).toBe(2000);
  });

  /**
   * ⚠️ OS TRÊS SILÊNCIOS CONTAM COMO TRATADOS. Reentrega, conflito e pausa não
   * produzem mensagem — mas em todos os três há um atendimento em andamento, e
   * deixar o robô de um turno responder por cima o atravessaria.
   */
  it.each([
    ["reentrega", { kind: "duplicate", runId: "r1" } as FlowTurnOutcome],
    ["conflito de concorrência", { kind: "conflict", runId: "r1" } as FlowTurnOutcome],
    ["atendimento humano", { kind: "paused", runId: "r1" } as FlowTurnOutcome],
  ])("silencia o robô também no caso de %s", async (_nome, desfecho) => {
    estado.desfecho = desfecho;

    const resultado = await processFlowMessages([mensagem()], new Set(), provider(), "corr");

    expect(resultado.handled).toEqual(["evt-1"]);
  });

  /**
   * ⚠️ A FALHA TAMBÉM É TRATADA, e é contraintuitivo. Uma execução que falhou
   * ESTÁ num fluxo, parada num nó que o robô de um turno desconhece; ele
   * responderia por cima de uma triagem em andamento. A conversa fica acesa na
   * caixa de entrada, que é onde uma PESSOA a vê.
   */
  it("não devolve ao robô uma execução que falhou", async () => {
    estado.desfecho = { kind: "failed", runId: "r1", reason: "no_matching_transition" };

    const resultado = await processFlowMessages([mensagem()], new Set(), provider(), "corr");

    expect(resultado.handled).toEqual(["evt-1"]);
    expect(resultado.failed).toBe(1);
  });

  /**
   * ⚠️ E A EXCEÇÃO É O INVERSO, porque a diferença é SABER o que aconteceu.
   * Numa falha do motor sabe-se que há um fluxo; numa exceção não se sabe se
   * ele chegou a mover. Na dúvida, deixar o robô responder é melhor que a
   * pessoa ficar sem resposta nenhuma.
   */
  it("devolve ao robô quando o motor explode", async () => {
    estado.explode = true;

    const resultado = await processFlowMessages([mensagem()], new Set(), provider(), "corr");

    expect(resultado.handled).toEqual([]);
    expect(resultado.failed).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Os silêncios de graça                                                      */
/* -------------------------------------------------------------------------- */

describe("as recusas que não vão ao banco", () => {
  /**
   * ⚠️ NENHUMA DELAS ENTRA EM `handled`. São recusas DESTE módulo, e não do
   * atendimento: uma mensagem sem texto não tem o que dar ao fluxo, mas pode
   * ter para o robô. Marcá-las aqui as mataria para os dois.
   */
  it.each([
    ["reentrega do webhook", { duplicate: true }],
    ["saiu do nosso número", { fromMe: true }],
    ["conversa de grupo", { isGroup: true }],
    ["mensagem sem texto", { text: "   " }],
  ])("pula %s sem chamar o motor e sem marcar como tratada", async (_nome, parcial) => {
    const resultado = await processFlowMessages([mensagem(parcial)], new Set(), provider(), "corr");

    expect(estado.turnos).toHaveLength(0);
    expect(resultado.handled).toEqual([]);
    expect(resultado.skipped).toBe(1);
  });

  it("pula o que outro consumidor já tratou", async () => {
    const resultado = await processFlowMessages(
      [mensagem()],
      new Set(["evt-1"]),
      provider(),
      "corr",
    );

    expect(estado.turnos).toHaveLength(0);
    expect(resultado.handled).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* As barreiras compartilhadas com o robô                                     */
/* -------------------------------------------------------------------------- */

describe("as barreiras que valem para o atendimento inteiro", () => {
  /**
   * ⚠️ UMA CHAVE GERAL SÓ, e este teste guarda a decisão. No dia em que o
   * atendimento automático disser algo errado, quem for desligá-lo às pressas
   * vai procurar UM interruptor — dois significa desligar um, ver o problema
   * continuar, e perder minutos com o sistema no ar dizendo a coisa errada.
   */
  it("a chave geral do robô desliga os fluxos também", async () => {
    estado.ligado = false;

    const resultado = await processFlowMessages([mensagem()], new Set(), provider(), "corr");

    expect(estado.turnos).toHaveLength(0);
    expect(resultado.handled).toEqual([]);
    expect(resultado.skipped).toBe(1);
  });

  /**
   * ⚠️ CONVERSA HUMANA NÃO SE ATRAVESSA, e o `skipped` aqui é deliberado: o
   * consumidor seguinte tem a MESMA barreira e vai recusar pelo mesmo motivo.
   * Ninguém responde, que é o desejado.
   */
  it("cala quando um atendente assumiu a conversa", async () => {
    estado.podeFalar = false;

    const resultado = await processFlowMessages([mensagem()], new Set(), provider(), "corr");

    expect(estado.turnos).toHaveLength(0);
    expect(resultado.handled).toEqual([]);
    expect(resultado.skipped).toBe(1);
  });

  it("cala quando o limite de uso estourou", async () => {
    estado.dentroDoLimite = false;

    const resultado = await processFlowMessages([mensagem()], new Set(), provider(), "corr");

    expect(estado.turnos).toHaveLength(0);
    expect(resultado.skipped).toBe(1);
  });

  /**
   * ⚠️ SEM FORNECEDOR, NEM SE MOVE O FLUXO. É o pior desfecho possível deste
   * módulo: o estado avançar, a pergunta seguinte ficar gravada como feita, e
   * nada sair — a pessoa esperaria uma mensagem que nunca foi enviada, parada
   * num nó que ela nunca viu.
   */
  it("não move o fluxo sem fornecedor configurado", async () => {
    const resultado = await processFlowMessages(
      [mensagem()],
      new Set(),
      new UnconfiguredProvider(),
      "corr",
    );

    expect(estado.turnos).toHaveLength(0);
    expect(resultado.handled).toEqual([]);
    expect(resultado.skipped).toBe(1);
  });
});
