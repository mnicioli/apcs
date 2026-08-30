import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeProvider } from "@/lib/messaging/providers/fake";
import type { MessagingProvider } from "@/lib/messaging/messaging.types";

/**
 * O WORKER DA DIVULGAÇÃO — com o fornecedor FALSO, nenhuma mensagem de verdade.
 *
 * ⚠️ O QUE ESTE ARQUIVO PROVA, e nenhum outro provava: **a ordem e a legenda**.
 * A Bolsa manda dois envios por associado — a imagem primeiro, sem texto, e o
 * PDF em seguida com a mensagem. Trocar a ordem não quebra tipo nenhum, não
 * falha no build e não aparece em nenhuma tela: só aparece no celular de
 * quatrocentas pessoas.
 *
 * O banco aqui é um dublê em memória, no mesmo espírito do de Enquetes: ele
 * imita as regras da fila que importam para a orquestração (reivindicar tira de
 * `pending`, liquidar fecha a linha), e não substitui o que o Postgres garante.
 */

interface Linha {
  id: string;
  member_id: string;
  member_name: string;
  member_phone: string;
  status: string;
  attempts: number;
  last_error: string | null;
}

const CAMPANHA = "b0000000-0000-4000-8000-000000000001";

const banco = {
  campanha: null as Record<string, unknown> | null,
  fila: [] as Linha[],
  encerrada: false,
  /** Caminhos do Storage que devem falhar ao assinar. */
  assinaturaQuebrada: new Set<string>(),
};

function semear(quantos = 1) {
  banco.fila = Array.from({ length: quantos }, (_, i) => ({
    id: `rec-${i + 1}`,
    member_id: `mem-${i + 1}`,
    member_name: `Associado ${i + 1}`,
    member_phone: `1999911000${i + 1}`,
    status: "pending",
    attempts: 0,
    last_error: null,
  }));
}

/** A Bolsa: imagem E documento. */
function campanhaDaBolsa() {
  banco.campanha = {
    id: CAMPANHA,
    source: "market_bulletin",
    body: "APCS\n\nNovo boletim de preços",
    media_bucket: "market",
    media_path: "b/1/pdf/boletim.pdf",
    media_filename: "boletim.pdf",
    image_bucket: "market",
    image_path: "b/1/image/boletim.jpg",
  };
}

/** Normativa: só o documento. */
function campanhaDeNormativa() {
  banco.campanha = {
    id: CAMPANHA,
    source: "normative",
    body: "APCS\n\nNova normativa publicada",
    media_bucket: "documents",
    media_path: "d/1/normativa.pdf",
    media_filename: "normativa.pdf",
    image_bucket: null,
    image_path: null,
  };
}

const rpc = vi.fn(async (nome: string, args: Record<string, unknown> = {}) => {
  switch (nome) {
    case "release_stale_broadcast_recipients":
      return { data: 0, error: null };

    case "claim_broadcast_recipients": {
      const limite = Number(args.p_limit ?? 25);
      const lote = banco.fila.filter((r) => r.status === "pending").slice(0, limite);
      for (const r of lote) {
        r.status = "sending";
        r.attempts += 1;
      }
      return { data: lote.map((r) => ({ ...r })), error: null };
    }

    case "settle_broadcast_recipient": {
      const linha = banco.fila.find((r) => r.id === args.p_recipient_id);
      if (linha) {
        linha.status = args.p_ok ? "sent" : "error";
        linha.last_error = args.p_ok ? null : String(args.p_error ?? "");
      }
      return { data: null, error: null };
    }

    case "finish_broadcast":
      banco.encerrada = true;
      return { data: null, error: null };

    default:
      return { data: null, error: null };
  }
});

const from = vi.fn((tabela: string) => {
  if (tabela === "broadcasts") {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: banco.campanha, error: null }) }),
      }),
    };
  }

  // `broadcast_recipients`: quantos ainda faltam.
  return {
    select: () => ({
      eq: () => ({
        in: async () => ({
          count: banco.fila.filter((r) => r.status === "pending" || r.status === "sending").length,
          error: null,
        }),
      }),
    }),
  };
});

const storage = {
  from: (bucket: string) => ({
    createSignedUrl: async (caminho: string) =>
      banco.assinaturaQuebrada.has(caminho)
        ? { data: null, error: { message: "objeto não encontrado" } }
        : {
            data: { signedUrl: `https://storage.teste/${bucket}/${caminho}?assinado` },
            error: null,
          },
  }),
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc, from, storage }),
}));

const provedorAtual = { atual: null as MessagingProvider | null };
vi.mock("@/lib/messaging/registry", () => ({
  messagingProvider: () => provedorAtual.atual,
}));

const { drainBroadcastQueue } = await import("./broadcast-dispatch");

/** Sem espera de relógio: ritmo e backoff têm testes próprios. */
const RAPIDO = { messagesPerSecond: 10_000, backoff: () => 0 } as const;

function usar(provider: MessagingProvider) {
  provedorAtual.atual = provider;
  return provider;
}

beforeEach(() => {
  banco.campanha = null;
  banco.fila = [];
  banco.encerrada = false;
  banco.assinaturaQuebrada = new Set();
  vi.clearAllMocks();
});

describe("Bolsa: dois envios por associado", () => {
  it("manda a IMAGEM primeiro e o documento depois", async () => {
    campanhaDaBolsa();
    semear(1);
    const fake = usar(new FakeProvider()) as FakeProvider;

    await drainBroadcastQueue(CAMPANHA, RAPIDO);

    expect(fake.outbox.map((m) => m.kind)).toEqual(["image", "document"]);
  });

  /**
   * ⚠️ A imagem vai SEM LEGENDA. Com texto nas duas, o associado receberia a
   * mesma mensagem duas vezes seguidas — que é o defeito que o silêncio da
   * primeira mensagem evita.
   */
  it("a imagem vai sem texto e o documento leva a mensagem", async () => {
    campanhaDaBolsa();
    semear(1);
    const fake = usar(new FakeProvider()) as FakeProvider;

    await drainBroadcastQueue(CAMPANHA, RAPIDO);

    expect(fake.sentImages[0]?.caption).toBe("");
    expect(fake.sentDocuments[0]?.caption).toContain("Novo boletim de preços");
  });

  it("a ordem se repete para cada associado, sem embaralhar", async () => {
    campanhaDaBolsa();
    semear(3);
    const fake = usar(new FakeProvider()) as FakeProvider;

    await drainBroadcastQueue(CAMPANHA, RAPIDO);

    // Uma dupla imagem→documento por pessoa, e o par de cada uma junto: sem
    // isto, alguém receberia a imagem de uma corrida e o PDF minutos depois.
    expect(fake.outbox.map((m) => m.kind)).toEqual([
      "image",
      "document",
      "image",
      "document",
      "image",
      "document",
    ]);
    for (let i = 0; i < 6; i += 2) {
      expect(fake.outbox[i]?.to).toBe(fake.outbox[i + 1]?.to);
    }
  });

  it("nunca cai para texto puro quando os dois arquivos estão lá", async () => {
    campanhaDaBolsa();
    semear(2);
    const fake = usar(new FakeProvider()) as FakeProvider;

    await drainBroadcastQueue(CAMPANHA, RAPIDO);

    expect(fake.sent).toHaveLength(0);
    expect(fake.sentImages).toHaveLength(2);
    expect(fake.sentDocuments).toHaveLength(2);
  });
});

describe("os módulos sem imagem continuam com um envio só", () => {
  it("normativa manda só o documento, com o texto", async () => {
    campanhaDeNormativa();
    semear(1);
    const fake = usar(new FakeProvider()) as FakeProvider;

    const corrida = await drainBroadcastQueue(CAMPANHA, RAPIDO);

    expect(fake.outbox.map((m) => m.kind)).toEqual(["document"]);
    expect(fake.sentImages).toHaveLength(0);
    expect(corrida.sent).toBe(1);
  });
});

describe("quando a imagem não vai", () => {
  /**
   * ⚠️ O VEREDITO É DO DOCUMENTO. Marcar o associado como erro porque a prévia
   * não subiu deixaria de fora o boletim inteiro por causa do acessório — e
   * quem clicou veria "1 com erro" numa divulgação que chegou.
   */
  it("o documento sai assim mesmo e o destinatário conta como enviado", async () => {
    campanhaDaBolsa();
    semear(1);

    const fake = new FakeProvider();
    // Recusa DEFINITIVA só da imagem — o documento continua funcionando. Feito
    // aqui e não no dublê compartilhado: é um cenário deste arquivo.
    usar({
      name: "fake-sem-imagem",
      configured: true,
      missing: [],
      send: (m) => fake.send(m),
      sendImage: async () => ({
        ok: false,
        retryable: false,
        code: "wa_media",
        message: "formato de imagem recusado",
      }),
      sendDocument: (m) => fake.sendDocument(m),
      verifySignature: (b, h) => fake.verifySignature(b, h),
      parseWebhook: (p) => fake.parseWebhook(p),
    });

    const corrida = await drainBroadcastQueue(CAMPANHA, RAPIDO);

    expect(fake.sentDocuments).toHaveLength(1);
    expect(corrida.sent).toBe(1);
    expect(corrida.errors).toBe(0);
    expect(banco.fila[0]?.status).toBe("sent");
  });

  it("imagem que não pôde ser assinada não impede o documento", async () => {
    campanhaDaBolsa();
    semear(1);
    banco.assinaturaQuebrada.add("b/1/image/boletim.jpg");
    const fake = usar(new FakeProvider()) as FakeProvider;

    const corrida = await drainBroadcastQueue(CAMPANHA, RAPIDO);

    expect(fake.sentImages).toHaveLength(0);
    expect(fake.outbox.map((m) => m.kind)).toEqual(["document"]);
    expect(corrida.sent).toBe(1);
  });

  /**
   * O espelho do caso acima: sem o PDF a divulgação AINDA acontece, porque
   * avisar que existe um boletim novo já vale — mas aí ela cai para o texto, e
   * o texto precisa sair.
   */
  it("documento que não pôde ser assinado vira texto puro, com a imagem antes", async () => {
    campanhaDaBolsa();
    semear(1);
    banco.assinaturaQuebrada.add("b/1/pdf/boletim.pdf");
    const fake = usar(new FakeProvider()) as FakeProvider;

    await drainBroadcastQueue(CAMPANHA, RAPIDO);

    expect(fake.outbox.map((m) => m.kind)).toEqual(["image", "text"]);
    expect(fake.sent[0]?.body).toContain("Novo boletim de preços");
  });
});
