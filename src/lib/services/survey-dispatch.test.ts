import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeProvider } from "@/lib/messaging/providers/fake";
import { UnconfiguredProvider } from "@/lib/messaging/providers/unconfigured";

/**
 * §59, §61, §74, §75, §76. O WORKER DE DISPARO, de ponta a ponta com o
 * fornecedor FALSO (§60 — nenhum teste manda mensagem de verdade).
 *
 * ⚠️ O banco aqui é um dublê EM MEMÓRIA que imita as regras que importam da
 * fila: reivindicar tira de `pending`, marcar sobe a escala, soltar devolve.
 * Ele não substitui a bateria SQL — aquela roda contra o Postgres de verdade e
 * é quem prova `for update skip locked`. Este arquivo prova o que o SQL não
 * alcança: a ORQUESTRAÇÃO. Quem repete, quem desiste, quem volta para a fila,
 * quem nunca é tentado duas vezes.
 */

interface Linha {
  id: string;
  survey_id: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string;
  status: string;
  attempts: number;
  last_error: string | null;
  provider_message_id: string | null;
  last_dispatch_id: string | null;
}

const ENQUETE = "5f000000-0000-4000-8000-000000000001";

const banco = {
  recipientes: [] as Linha[],
  contextosAbertos: [] as string[],
  corridaFechada: false,
  optOutsBloqueados: 0,
  soltos: [] as string[],
  /**
   * A linha de `surveys` que a mensagem lê para montar título, descrição e
   * prazo. `get_survey_for_chatbot` devolve uma linha por ALTERNATIVA e não traz
   * esses campos; o despachante busca-os à parte.
   */
  enquete: {
    title: "Expectativa da arroba",
    description: "Sua resposta orienta a negociação da semana.",
    starts_at: "2026-09-02T15:15:00.000Z",
    ends_at: "2026-09-02T18:25:00.000Z",
  } as {
    title: string;
    description: string | null;
    starts_at: string | null;
    ends_at: string | null;
  },
};

function semear(quantos: number, telefone?: (i: number) => string) {
  banco.recipientes = Array.from({ length: quantos }, (_, i) => ({
    id: `rec-${i + 1}`,
    survey_id: ENQUETE,
    contact_id: `con-${i + 1}`,
    contact_name: `Teste ${i + 1}`,
    contact_phone: telefone ? telefone(i) : `(19) 9911${String(i + 1).padStart(5, "0")}`,
    status: "pending",
    attempts: 0,
    last_error: null,
    provider_message_id: null,
    last_dispatch_id: null,
  }));
}

const ESCALA = ["pending", "sending", "sent", "delivered", "read", "responded"];

const rpc = vi.fn(async (nome: string, args: Record<string, unknown> = {}) => {
  switch (nome) {
    case "block_opted_out_recipients":
      return { data: banco.optOutsBloqueados, error: null };

    case "start_survey_dispatch":
      return {
        data: {
          id: "disp-1",
          total_recipients: banco.recipientes.filter((r) => r.status === "pending").length,
        },
        error: null,
      };

    case "get_survey_for_chatbot":
      return {
        data: [
          {
            title: banco.enquete.title,
            question: "Como ficará o valor da arroba?",
            option_position: 1,
            option_text: "Sobe",
          },
          {
            title: banco.enquete.title,
            question: "Como ficará o valor da arroba?",
            option_position: 2,
            option_text: "Desce",
          },
        ],
        error: null,
      };

    // A fila: só quem está `pending`, e quem sai vira `sending`. É esta linha
    // que dá a idempotência do §76 no dublê — a mesma que o índice + o
    // `skip locked` dão no Postgres.
    case "claim_survey_recipients": {
      const limite = Number(args.p_limit ?? 25);
      const lote = banco.recipientes.filter((r) => r.status === "pending").slice(0, limite);
      for (const r of lote) {
        r.status = "sending";
        r.last_dispatch_id = String(args.p_dispatch_id);
      }
      return { data: lote.map((r) => ({ ...r })), error: null };
    }

    case "mark_survey_recipient": {
      const linha = banco.recipientes.find((r) => r.id === args.p_recipient_id);
      if (!linha) return { data: null, error: null };
      const novo = String(args.p_status);
      const sobe = ESCALA.indexOf(novo) > ESCALA.indexOf(linha.status);
      if (novo === "error" || sobe) {
        linha.status = novo;
        if (novo === "sent" || novo === "error") linha.attempts += 1;
        if (novo === "error") linha.last_error = String(args.p_error ?? "");
        if (args.p_provider_message_id) {
          linha.provider_message_id = String(args.p_provider_message_id);
        }
      }
      return { data: { ...linha }, error: null };
    }

    case "release_survey_recipients": {
      const ids = (args.p_ids ?? []) as string[];
      let n = 0;
      for (const id of ids) {
        const linha = banco.recipientes.find((r) => r.id === id);
        if (linha && linha.status === "sending") {
          linha.status = "pending";
          banco.soltos.push(id);
          n += 1;
        }
      }
      return { data: n, error: null };
    }

    case "open_survey_context":
      banco.contextosAbertos.push(String(args.p_recipient_id));
      return { data: { id: "ctx-1" }, error: null };

    case "finish_survey_dispatch":
      banco.corridaFechada = true;
      return { data: { id: "disp-1", status: "completed" }, error: null };

    default:
      return { data: null, error: null };
  }
});

const from = vi.fn(() => ({
  select: () => ({
    eq: () => ({
      // `survey_recipients`: quantos ainda estão na fila.
      eq: () => ({
        count: banco.recipientes.filter((r) => r.status === "pending").length,
        error: null,
      }),
      // `surveys`: os campos que a mensagem usa e que a função do banco não traz.
      maybeSingle: () => ({ data: banco.enquete, error: null }),
    }),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc, from }),
}));

const { runSurveyDispatch, __resetDispatchBreaker } = await import("./survey-dispatch");

/** Sem espera de relógio: o backoff e o ritmo já têm testes próprios. */
const RAPIDO = { messagesPerSecond: 10_000, backoff: () => 0 } as const;

function contar(status: string) {
  return banco.recipientes.filter((r) => r.status === status).length;
}

beforeEach(() => {
  banco.recipientes = [];
  banco.contextosAbertos = [];
  banco.corridaFechada = false;
  banco.optOutsBloqueados = 0;
  banco.soltos = [];
  __resetDispatchBreaker();
  vi.clearAllMocks();
});

describe("§61. Campanha com um e com vários", () => {
  it("um destinatário: uma mensagem, um contexto", async () => {
    semear(1);
    const fake = new FakeProvider();

    const r = await runSurveyDispatch(ENQUETE, fake, RAPIDO);

    expect(r.sent).toBe(1);
    expect(r.errors).toBe(0);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]?.to).toBe("5519991100001");
    // §7. O contexto nasce DEPOIS do envio confirmado.
    expect(banco.contextosAbertos).toEqual(["rec-1"]);
    expect(banco.corridaFechada).toBe(true);
  });

  it("a mensagem é a do §5: APCS, pergunta, alternativas e instrução", async () => {
    semear(1);
    const fake = new FakeProvider();
    await runSurveyDispatch(ENQUETE, fake, RAPIDO);

    const corpo = fake.sent[0]?.body ?? "";
    expect(corpo).toContain("APCS");
    expect(corpo).toContain("Como ficará o valor da arroba?");
    expect(corpo).toContain("Sobe");
    expect(corpo).toContain("Desce");
    expect(corpo).toMatch(/responda com o número/i);

    // ⚠️ TÍTULO, DESCRIÇÃO E PRAZO CHEGAM PELA SEGUNDA CONSULTA, não pela função
    // do banco. Se ela deixar de ser feita, os três somem juntos e em silêncio —
    // a mensagem continua saindo, só que pobre. Por isso são verificados aqui, no
    // caminho real do despachante, e não só no teste de unidade do texto.
    expect(corpo).toContain("*Expectativa da arroba*");
    expect(corpo).toContain("Sua resposta orienta a negociação da semana.");
    expect(corpo).toMatch(/_Você pode responder em .+_$/);
  });

  it("dez destinatários: dez mensagens, nenhuma repetida", async () => {
    semear(10);
    const fake = new FakeProvider();

    const r = await runSurveyDispatch(ENQUETE, fake, RAPIDO);

    expect(r.sent).toBe(10);
    expect(fake.sent).toHaveLength(10);
    expect(new Set(fake.sent.map((m) => m.to)).size).toBe(10);
    expect(contar("sent")).toBe(10);
  });

  it("respeita o lote e continua até esvaziar a fila", async () => {
    semear(10);
    const fake = new FakeProvider();

    await runSurveyDispatch(ENQUETE, fake, { ...RAPIDO, batchSize: 3 });

    expect(fake.sent).toHaveLength(10);
    expect(contar("pending")).toBe(0);
  });
});

describe("§74. Falha individual não cancela a campanha", () => {
  it("⚠️ 10 destinatários, 2 falhas → 8 enviados e 2 erros", async () => {
    semear(10);
    const fake = new FakeProvider();
    fake.rejectPermanently("5519991100003");
    fake.rejectPermanently("5519991100007");

    const r = await runSurveyDispatch(ENQUETE, fake, RAPIDO);

    expect(r.sent).toBe(8);
    expect(r.errors).toBe(2);
    expect(contar("sent")).toBe(8);
    expect(contar("error")).toBe(2);
    // A campanha alcançou oito pessoas. Interromper no terceiro erro deixaria
    // sete sem receber por causa de dois cadastros ruins.
    expect(banco.corridaFechada).toBe(true);
  });

  it("o erro fica registrado com o motivo, por pessoa (§27)", async () => {
    semear(3);
    const fake = new FakeProvider();
    fake.rejectPermanently("5519991100002", "recipient not a WhatsApp user");

    await runSurveyDispatch(ENQUETE, fake, RAPIDO);

    const falho = banco.recipientes.find((r) => r.id === "rec-2");
    expect(falho?.status).toBe("error");
    expect(falho?.last_error).toContain("wa_131026");
    expect(falho?.attempts).toBe(1);
  });
});

describe("§29, §30. Telefone que não recebe WhatsApp", () => {
  it("⚠️ FIXO nem chega ao fornecedor", async () => {
    // O caso real da base: `(14) 3622-8140`. Mandado, ele não daria erro na
    // hora — daria "não entregue" horas depois, sem ninguém olhando.
    semear(3, (i) => (i === 1 ? "(14) 3622-8140" : `(19) 9911${String(i + 1).padStart(5, "0")}`));
    const fake = new FakeProvider();

    const r = await runSurveyDispatch(ENQUETE, fake, RAPIDO);

    expect(fake.sent).toHaveLength(2);
    expect(r.errors).toBe(1);
    const fixo = banco.recipientes.find((x) => x.contact_phone === "(14) 3622-8140");
    expect(fixo?.status).toBe("error");
    expect(fixo?.last_error).toMatch(/cadastre um celular/i);
  });

  it("contato sem telefone vira erro com a frase certa", async () => {
    semear(2, (i) => (i === 0 ? "" : "(19) 99123-4567"));
    const fake = new FakeProvider();

    await runSurveyDispatch(ENQUETE, fake, RAPIDO);

    expect(banco.recipientes[0]?.last_error).toMatch(/sem telefone/i);
    expect(fake.sent).toHaveLength(1);
  });
});

describe("§75. Retry, backoff e limite de tentativas", () => {
  it("falha temporária que cura sozinha vira envio", async () => {
    semear(1);
    const fake = new FakeProvider();
    fake.failTemporarily("5519991100001", 2);

    const r = await runSurveyDispatch(ENQUETE, fake, RAPIDO);

    expect(r.sent).toBe(1);
    expect(fake.sent).toHaveLength(1);
  });

  it("⚠️ o limite de tentativas existe — não insiste para sempre", async () => {
    semear(1);
    const fake = new FakeProvider();
    fake.failTemporarily("5519991100001", 99);

    const r = await runSurveyDispatch(ENQUETE, fake, { ...RAPIDO, maxAttempts: 3 });

    expect(r.sent).toBe(0);
    expect(contar("error")).toBe(1);
    expect(fake.sent).toHaveLength(0);
  });

  it("⚠️ erro DEFINITIVO não é repetido nenhuma vez", async () => {
    // Insistir num número que o fornecedor já disse não existir queima cota
    // sem chance nenhuma de sucesso.
    semear(1);
    const fake = new FakeProvider();
    const espia = vi.spyOn(fake, "send");
    fake.rejectPermanently("5519991100001");

    await runSurveyDispatch(ENQUETE, fake, { ...RAPIDO, maxAttempts: 3 });

    expect(espia).toHaveBeenCalledTimes(1);
  });
});

describe("§21, §61. Fornecedor indisponível", () => {
  it("⚠️ o disjuntor abre e o RESTO VOLTA PARA A FILA, sem virar erro", async () => {
    // Marcar erro aqui diria "falhou o envio para o João" quando o que houve
    // foi "o WhatsApp estava fora do ar" — e o operador sairia conferindo
    // telefone por telefone em vez de esperar cinco minutos.
    semear(30);
    const fake = new FakeProvider();
    fake.goDown(999);

    const r = await runSurveyDispatch(ENQUETE, fake, { ...RAPIDO, maxAttempts: 1 });

    expect(r.sent).toBe(0);
    expect(r.released).toBeGreaterThan(0);
    expect(contar("pending")).toBeGreaterThan(0);
    expect(r.remaining).toBe(true);
    // Alguns viraram erro (os que foram tentados antes do disjuntor abrir), mas
    // não TODOS: é essa a diferença que o §21 protege.
    expect(contar("error")).toBeLessThan(30);
  });

  it("depois que o fornecedor volta, o ciclo seguinte manda o resto", async () => {
    semear(10);
    const fake = new FakeProvider();
    fake.goDown(999);
    await runSurveyDispatch(ENQUETE, fake, { ...RAPIDO, maxAttempts: 1 });

    // O fornecedor voltou e o disjuntor descansou.
    fake.reset();
    __resetDispatchBreaker();
    for (const linha of banco.recipientes) {
      if (linha.status === "error") linha.status = "pending";
    }

    const r = await runSurveyDispatch(ENQUETE, fake, RAPIDO);
    expect(r.sent).toBe(10);
  });
});

describe("§76. Rodar o worker duas vezes", () => {
  it("⚠️ UMA ÚNICA MENSAGEM POR PESSOA", async () => {
    semear(5);
    const fake = new FakeProvider();

    await runSurveyDispatch(ENQUETE, fake, RAPIDO);
    await runSurveyDispatch(ENQUETE, fake, RAPIDO);

    expect(fake.sent).toHaveLength(5);
    expect(new Set(fake.sent.map((m) => m.to)).size).toBe(5);
  });

  it("a segunda execução não abre contexto de novo", async () => {
    semear(3);
    const fake = new FakeProvider();

    await runSurveyDispatch(ENQUETE, fake, RAPIDO);
    await runSurveyDispatch(ENQUETE, fake, RAPIDO);

    expect(banco.contextosAbertos).toHaveLength(3);
  });
});

describe("§88, §95. Fornecedor não configurado", () => {
  it("⚠️ RECUSA ANTES DE ABRIR A CORRIDA — a fila fica intacta", async () => {
    semear(10);

    const r = await runSurveyDispatch(ENQUETE, new UnconfiguredProvider(["APCS_WHATSAPP_TOKEN"]));

    expect(r.skipped).toBe("provider_not_configured");
    expect(r.sent).toBe(0);
    // Ninguém foi marcado como erro: sem isto, configurar depois exigiria
    // limpar dez linhas de falha na mão antes de tentar de novo.
    expect(contar("error")).toBe(0);
    expect(contar("pending")).toBe(10);
    expect(banco.corridaFechada).toBe(false);
  });

  it("nenhuma corrida chega a ser aberta", async () => {
    semear(3);
    await runSurveyDispatch(ENQUETE, new UnconfiguredProvider([]));
    expect(rpc).not.toHaveBeenCalledWith("start_survey_dispatch", expect.anything());
  });
});

describe("§32. Opt-out sai antes do envio", () => {
  it("o bloqueio roda antes de reivindicar", async () => {
    semear(2);
    banco.optOutsBloqueados = 1;
    const fake = new FakeProvider();

    const r = await runSurveyDispatch(ENQUETE, fake, RAPIDO);

    expect(r.blocked).toBe(1);
    const ordem = rpc.mock.calls.map((c) => c[0]);
    expect(ordem.indexOf("block_opted_out_recipients")).toBeLessThan(
      ordem.indexOf("claim_survey_recipients"),
    );
  });
});
