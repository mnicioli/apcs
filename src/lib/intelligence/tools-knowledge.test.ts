import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@/modules/intelligence/intelligence.types";

/**
 * A BUSCA DA BASE DE CONHECIMENTO RECEBE A MENSAGEM — e este arquivo existe
 * porque, por um tempo, ela não recebia.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ O DEFEITO QUE ESTES TESTES FIXAM
 * ----------------------------------------------------------------------------
 * `tools.ts` documentava, no comentário da ferramenta, que ela recebe a
 * mensagem inteira — e explicava por quê: a busca casa PALAVRAS-CHAVE com o que
 * a pessoa escreveu. O código passava o `subject`, o termo que o modelo extrai.
 *
 * O comentário estava certo e não era executado. Medido contra a API em
 * 01/09/2026, com a pergunta que o próprio comentário usa de exemplo:
 *
 *   "vocês abrem que horas?"  →  intenção certa, confiança 0.85, subject NULO
 *
 * A ferramenta descartava consulta com menos de 2 caracteres e devolvia
 * `empty`. O robô respondia "nada publicado" sem ter feito uma única consulta.
 * Noutra rodada o subject veio "horário de funcionamento", e aí a chave "horas"
 * também não casava — "horas" não está contido em "horario".
 *
 * ⚠️ POR QUE UM TESTE DE COMENTÁRIO. O que se fixa aqui não é um detalhe de
 * implementação: é QUAL DAS DUAS ENTRADAS alimenta a busca. Trocar uma pela
 * outra não quebra tipo nem lint, e o sintoma em produção é o robô dizendo
 * educadamente que não há nada publicado — que é indistinguível do caso normal
 * de não haver nada publicado mesmo.
 */

const buscar = vi.hoisted(() => vi.fn());

vi.mock("@/lib/services/knowledge-chatbot", () => ({
  searchKnowledgeForChatbot: buscar,
}));

const { toolFor } = await import("./tools");

function contexto(message: string): ToolContext {
  return { message, memberId: null, phone: null, correlationId: "teste" };
}

const ITEM = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Horário de atendimento",
  content: "A APCS atende de segunda a sexta, das 8h às 17h.",
  category: "Atendimento",
  score: 3,
};

beforeEach(() => {
  buscar.mockReset();
});

describe("getKnowledge", () => {
  it("busca com a mensagem da pessoa, e não com o assunto extraído", async () => {
    buscar.mockResolvedValue([ITEM]);

    // O modelo reescreveu o assunto — é o que ele fez de verdade na medição.
    await toolFor("getKnowledge").run(
      "horário de funcionamento",
      contexto("vocês abrem que horas?"),
    );

    expect(buscar).toHaveBeenCalledWith("vocês abrem que horas?");
  });

  it("busca mesmo quando o assunto extraído vem nulo", async () => {
    buscar.mockResolvedValue([ITEM]);

    // ⚠️ O CASO EXATO DA PRODUÇÃO. Aqui a busca nem chegava a acontecer.
    const resultado = await toolFor("getKnowledge").run(null, contexto("vocês abrem que horas?"));

    expect(buscar).toHaveBeenCalledWith("vocês abrem que horas?");
    expect(resultado.status).toBe("ok");
  });

  it("entrega o texto do item exatamente como está escrito", async () => {
    buscar.mockResolvedValue([ITEM]);

    const resultado = await toolFor("getKnowledge").run(null, contexto("que horas abre?"));

    // Sem resumir, sem reescrever, sem juntar dois itens: é o §2.
    expect(resultado).toEqual({
      status: "ok",
      body: ITEM.content,
      attachments: [],
      source: { type: "knowledge", id: ITEM.id },
    });
  });

  it("responde o primeiro colocado quando há mais de um", async () => {
    buscar.mockResolvedValue([
      ITEM,
      { ...ITEM, id: "22222222-2222-2222-2222-222222222222", score: 2 },
    ]);

    const resultado = await toolFor("getKnowledge").run(null, contexto("que horas abre?"));

    expect(resultado).toMatchObject({ source: { id: ITEM.id } });
  });

  it("não vai ao banco quando a mensagem é curta demais para significar algo", async () => {
    const resultado = await toolFor("getKnowledge").run(null, contexto(" a "));

    expect(buscar).not.toHaveBeenCalled();
    expect(resultado.status).toBe("empty");
  });

  it("nada encontrado é vazio, e não erro", async () => {
    buscar.mockResolvedValue([]);

    const resultado = await toolFor("getKnowledge").run(
      null,
      contexto("assunto que ninguém cadastrou"),
    );

    // A distinção importa: `empty` é trabalho de quem publica, `error` é de
    // quem cuida do sistema, e as duas frases são diferentes.
    expect(resultado.status).toBe("empty");
  });

  it("falha da busca vira erro tratado, nunca exceção", async () => {
    buscar.mockRejectedValue(new Error("banco fora do ar"));

    // ⚠️ Uma exceção aqui viraria 500 no webhook, o fornecedor reentregaria o
    // payload e o resultado seria um laço de reentrega sobre um erro que não se
    // resolve sozinho.
    const resultado = await toolFor("getKnowledge").run(null, contexto("vocês abrem que horas?"));

    expect(resultado.status).toBe("error");
  });
});
