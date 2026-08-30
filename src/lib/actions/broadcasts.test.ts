import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O QUE `startBroadcastAction` MANDA AO BANCO — uma chamada, com tudo.
 *
 * ⚠️ ESTE ARQUIVO NASCEU COBRINDO UMA PONTE QUE JÁ FOI DEMOLIDA. Os quatro
 * parâmetros `p_image_*` nasceram em 20260907000000_broadcast_image.sql, e entre
 * o deploy e a migration o banco só conhecia a versão antiga da função: o
 * PostgREST respondia PGRST202 e NENHUMA divulgação sairia, em nenhum dos quatro
 * módulos, por um deploy que "só acrescentava uma imagem". A action reenviava
 * sem a imagem, e a Bolsa saía só com o PDF.
 *
 * A migration está aplicada e a segunda tentativa saiu. O que sobrou aqui são as
 * duas asserções que NÃO eram sobre a ponte, e que continuam valendo: a chamada
 * leva imagem e documento juntos, e é UMA só — um erro do banco volta traduzido
 * na primeira, sem retentativa que possa escrever duas vezes.
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

describe("a chamada que sai", () => {
  it("leva imagem e documento juntos, numa vez só", async () => {
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

  /**
   * ⚠️ PGRST202 MUDOU DE SIGNIFICADO quando a ponte saiu, e é isso que este
   * teste fixa.
   *
   * Antes ele queria dizer "a migration da imagem ainda não rodou" e disparava
   * uma segunda tentativa. Agora quer dizer o que sempre quis dizer de verdade —
   * o banco está atrás do código — e vira `dbOutdated`, cuja mensagem manda
   * aplicar migration em vez de tentar de novo. Reenviar aqui seria esconder o
   * diagnóstico atrás de uma falha diferente.
   */
  it("função ausente vira `dbOutdated`, sem segunda tentativa", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.start_broadcast in the schema cache",
      },
    });

    const resultado = await chamar();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("dbOutdated");
  });
});

describe("erro de regra de negócio", () => {
  /**
   * ⚠️ NENHUM ERRO GERA SEGUNDA TENTATIVA. Repetir uma falha real (permissão,
   * público inválido) daria duas chances de escrever no banco — e o segundo erro
   * esconderia o primeiro.
   */
  it("devolve o erro traduzido na primeira", async () => {
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
