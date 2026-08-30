import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A JANELA ENTRE O DEPLOY E A MIGRATION — o caso que este arquivo existe para
 * cobrir.
 *
 * ⚠️ Os quatro parâmetros `p_image_*` nasceram em
 * 20260907000000_broadcast_image.sql. Do momento em que o código sobe até o
 * momento em que alguém roda a migration, o banco só conhece a versão antiga da
 * função — e o PostgREST responde "could not find the function" (PGRST202). Sem
 * a segunda tentativa, o efeito seria DIVULGAÇÃO NENHUMA saindo, em nenhum dos
 * quatro módulos, por um deploy que "só acrescentava uma imagem".
 *
 * ⚠️ É UM TESTE DE PONTE, e ele MORRE junto com a ponte: quando a migration
 * estiver aplicada em produção e o `if` sair da action, este arquivo sai junto.
 * Está escrito aqui para que, enquanto a rede existir, ela seja de verdade.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// A matriz de cargos fica de fora: o Supabase aqui é um dublê e não sabe
// respondê-la. O RBAC cai na matriz do código, que é o que interessa.
vi.mock("@/lib/services/roles", () => ({
  ensureRoleMatrix: async () => [],
  invalidateRoleCache: () => {},
}));

const rpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          returns: () => ({
            maybeSingle: async () => ({ data: { role: "admin", active: true }, error: null }),
          }),
        }),
      }),
    }),
    rpc,
  }),
}));

const BOLETIM = "b0000000-0000-4000-8000-000000000009";

// O que a Bolsa resolve: imagem E documento.
vi.mock("@/lib/services/broadcasts", () => ({
  resolveBroadcastSubject: async () => ({
    subject: {
      source: "market_bulletin",
      title: "Bolsa de Suínos",
      effectiveDate: "2026-08-30",
      versionName: "Bolsa_30Ago26",
    },
    attachments: {
      image: { bucket: "market", path: "b/1/image/x.jpg", mime: "image/jpeg", filename: "x.jpg" },
      document: {
        bucket: "market",
        path: "b/1/pdf/x.pdf",
        mime: "application/pdf",
        filename: "x.pdf",
      },
    },
  }),
  canBroadcastLecture: () => true,
  getBroadcastAudience: async () => ({ reachable: 1, blocked: 0 }),
}));

// O worker não roda: `queued > 0` o chamaria, e nenhum teste manda mensagem.
vi.mock("@/lib/services/broadcast-dispatch", () => ({
  drainBroadcastQueue: async () => ({ sent: 0, remainingCount: 0 }),
}));

const { startBroadcastAction } = await import("./broadcasts");

const FILA_CRIADA = {
  data: [{ broadcast_id: "bc-1", queued: 0, blocked: 0 }],
  error: null,
};

const NAO_ACHOU_A_FUNCAO = {
  data: null,
  error: {
    code: "PGRST202",
    message:
      "Could not find the function public.start_broadcast(p_body, p_image_bucket, ...) in the schema cache",
    details: null,
    hint: null,
  },
};

function chamar() {
  return startBroadcastAction({
    source: "market_bulletin",
    sourceId: BOLETIM,
    segmentIds: ["ce9a9213-1ecf-4a68-a01a-b593bfad3c44"],
  });
}

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("banco já com os parâmetros de imagem", () => {
  it("manda os quatro `p_image_*` de uma vez só", async () => {
    rpc.mockResolvedValue(FILA_CRIADA);

    const resultado = await chamar();

    expect(resultado.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_image_bucket: "market",
      p_image_path: "b/1/image/x.jpg",
      p_media_path: "b/1/pdf/x.pdf",
    });
  });
});

describe("banco ainda sem os parâmetros de imagem", () => {
  it("repete SEM a imagem em vez de deixar a divulgação morrer", async () => {
    rpc.mockResolvedValueOnce(NAO_ACHOU_A_FUNCAO).mockResolvedValueOnce(FILA_CRIADA);

    const resultado = await chamar();

    expect(resultado.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);

    // A segunda chamada é exatamente o que a versão antiga da função espera:
    // um `p_image_*` sobrando faria o PostgREST recusar de novo.
    const segunda = rpc.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(segunda.p_media_path).toBe("b/1/pdf/x.pdf");
    expect(Object.keys(segunda).some((chave) => chave.startsWith("p_image_"))).toBe(false);
  });

  it("avisa no log do servidor qual migration está faltando", async () => {
    rpc.mockResolvedValueOnce(NAO_ACHOU_A_FUNCAO).mockResolvedValueOnce(FILA_CRIADA);

    await chamar();

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("20260907000000_broadcast_image.sql"),
    );
  });

  it("o mesmo vale para o 42883 do Postgres, não só para o PGRST202", async () => {
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42883", message: "function does not exist" },
      })
      .mockResolvedValueOnce(FILA_CRIADA);

    const resultado = await chamar();

    expect(resultado.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("erro que NÃO é assinatura faltando", () => {
  /**
   * ⚠️ A rede é estreita de propósito. Repetir sobre qualquer erro faria uma
   * falha real (permissão, público inválido) virar duas tentativas e duas
   * chances de escrever no banco — e o segundo erro esconderia o primeiro.
   */
  it("não repete: devolve o erro traduzido na primeira", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "BC003", message: "Publico-alvo desconhecido ou inativo." },
    });

    const resultado = await chamar();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("broadcastUnknownSegment");
  });
});
