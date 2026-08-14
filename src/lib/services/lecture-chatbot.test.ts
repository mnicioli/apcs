import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A PORTA DO CHATBOT (§8, §55, §57, §58, §59, §60).
 *
 * O que se prova aqui é o CONTRATO da porta, com o cliente `service_role`
 * mockado: quais argumentos saem, o que volta para o bot, e o que nunca volta.
 *
 * A garantia de que o chatbot não consegue aprovar uma palestra não está neste
 * arquivo e nem poderia estar — ela é a ASSINATURA da função no banco, que não
 * tem parâmetro de status, prioridade, responsável nem palestrante. Aqui se
 * confere que a chamada é a esperada; lá se confere que nenhuma outra é possível
 * (bateria SQL, casos A25–A28).
 */

const rpc = vi.fn();
const maybeSingle = vi.fn();
const eqCalls: [string, unknown][] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc,
    from: () => ({
      select: () => {
        const chain = {
          eq: (coluna: string, valor: unknown) => {
            eqCalls.push([coluna, valor]);
            return chain;
          },
          returns: () => chain,
          maybeSingle,
        };
        return chain;
      },
    }),
  }),
}));

const { createLectureRequest, getLectureRequestByProtocol } = await import("./lecture-chatbot");

const PEDIDO = {
  requesterName: "João da Silva",
  city: "Toledo",
  type: "company" as const,
  theme: "Manejo sanitário em granjas",
  eventDate: "2026-09-20",
};

beforeEach(() => {
  rpc.mockReset();
  maybeSingle.mockReset();
  eqCalls.length = 0;
  rpc.mockResolvedValue({
    data: { id: "abc", protocol: "SOL-001024", status: "requested" },
    error: null,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("registrar a solicitação (§8, §55)", () => {
  it("devolve o protocolo e a situação", async () => {
    const resultado = await createLectureRequest(PEDIDO);

    expect(resultado).toEqual({
      status: "created",
      protocol: "SOL-001024",
      lectureStatus: "requested",
    });
  });

  it("manda para o banco exatamente os campos do §7", async () => {
    await createLectureRequest({
      ...PEDIDO,
      startTime: "14:00",
      location: "Sede do sindicato",
      format: "in_person",
      attendeesEstimated: 40,
      notes: "Preferência pela parte da manhã",
      requesterEmail: "joao@exemplo.com.br",
      requesterPhone: "(45) 99999-0000",
      requesterOrganization: "Granja Silva",
    });

    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;

    expect(args.p_requester_name).toBe("João da Silva");
    expect(args.p_city).toBe("Toledo");
    expect(args.p_type).toBe("company");
    expect(args.p_theme).toBe("Manejo sanitário em granjas");
    expect(args.p_event_date).toBe("2026-09-20");
    expect(args.p_start_time).toBe("14:00");
    expect(args.p_location).toBe("Sede do sindicato");
    expect(args.p_format).toBe("in_person");
    expect(args.p_attendees_estimated).toBe(40);
    expect(args.p_notes).toBe("Preferência pela parte da manhã");
  });

  it("NÃO existe argumento de situação, prioridade, responsável ou palestrante (§6)", async () => {
    await createLectureRequest(PEDIDO);
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;

    expect(Object.keys(args)).not.toContain("p_status");
    expect(Object.keys(args)).not.toContain("p_priority");
    expect(Object.keys(args)).not.toContain("p_responsible_id");
    expect(Object.keys(args)).not.toContain("p_speaker_id");
    expect(Object.keys(args)).not.toContain("p_origin");
  });
});

describe("dados obrigatórios (§9, §10)", () => {
  const FALTANDO: readonly [string, Record<string, unknown>][] = [
    ["nome", { requesterName: "" }],
    ["cidade", { city: "" }],
    ["tema", { theme: "" }],
    ["data", { eventDate: "" }],
  ];

  for (const [campo, quebra] of FALTANDO) {
    it(`sem ${campo}: recusa antes de tocar o banco`, async () => {
      const resultado = await createLectureRequest({ ...PEDIDO, ...quebra } as never);

      expect(resultado.status).toBe("invalid");
      expect(rpc).not.toHaveBeenCalled();
    });
  }

  it("a mensagem é amigável, não é código", async () => {
    const resultado = await createLectureRequest({ ...PEDIDO, requesterName: "" });

    expect(resultado.status).toBe("invalid");
    if (resultado.status === "invalid") {
      expect(resultado.issues.join(" ")).toContain("Informe seu nome.");
      expect(resultado.issues.join(" ")).not.toMatch(/[A-Z]{2}\d{3}|constraint|column/);
    }
  });

  it("tipo OUTROS sem detalhe: recusado", async () => {
    const resultado = await createLectureRequest({ ...PEDIDO, type: "other" });

    expect(resultado.status).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("tipo OUTROS com detalhe: aceito", async () => {
    const resultado = await createLectureRequest({
      ...PEDIDO,
      type: "other",
      typeOther: "Cooperativa",
    });

    expect(resultado.status).toBe("created");
  });

  it("data tecnicamente inválida é recusada", async () => {
    const resultado = await createLectureRequest({ ...PEDIDO, eventDate: "2026-02-31" });

    expect(resultado.status).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
});

/**
 * IDEMPOTÊNCIA (§59, §60).
 *
 * O §59 pede para NÃO deduplicar agressivamente: duas solicitações legítimas
 * iguais precisam passar. O §60 pede chave para o retry TÉCNICO. As duas coisas
 * juntas significam: a chave vem de fora, é opaca, e o serviço não inventa uma.
 */
describe("chave de idempotência", () => {
  it("a chave chega ao banco quando o chamador manda", async () => {
    await createLectureRequest({ ...PEDIDO, idempotencyKey: "conv-8f3a12bb-turno-7" });
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;

    expect(args.p_idempotency_key).toBe("conv-8f3a12bb-turno-7");
  });

  it("sem chave, o parâmetro vai nulo — nada é inventado", async () => {
    await createLectureRequest(PEDIDO);
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;

    expect(args.p_idempotency_key).toBeNull();
  });

  it("dois pedidos idênticos sem chave continuam sendo dois (§59)", async () => {
    await createLectureRequest(PEDIDO);
    await createLectureRequest(PEDIDO);

    // Se um dia alguém "melhorar" isto gerando a chave a partir de nome+data,
    // duas cooperativas pedindo o mesmo tema no mesmo dia viram um pedido só —
    // e a segunda pessoa recebe o protocolo da primeira.
    expect(rpc).toHaveBeenCalledTimes(2);
    for (const chamada of rpc.mock.calls) {
      expect((chamada[1] as Record<string, unknown>).p_idempotency_key).toBeNull();
    }
  });

  it("a chave enviada é usada como veio, sem misturar conteúdo", async () => {
    await createLectureRequest({ ...PEDIDO, idempotencyKey: "conv-8f3a12bb-turno-7" });
    const chave = (rpc.mock.calls[0]?.[1] as Record<string, unknown>).p_idempotency_key as string;

    expect(chave).toBe("conv-8f3a12bb-turno-7");
    expect(chave).not.toContain("João");
    expect(chave).not.toContain("2026-09-20");
  });

  it("chave curta é recusada antes do banco", async () => {
    const resultado = await createLectureRequest({ ...PEDIDO, idempotencyKey: "abc" });

    expect(resultado.status).toBe("invalid");
    expect(rpc).not.toHaveBeenCalled();
  });
});

/**
 * §57/§59: o que volta para uma janela de chat pública.
 */
describe("falha no banco", () => {
  it("não devolve detalhe nenhum para o bot", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "lectures_protocol_key"',
        details: "Key (protocol)=(SOL-001024) already exists.",
      },
    });

    const resultado = await createLectureRequest(PEDIDO);

    expect(resultado).toEqual({ status: "failed" });
    expect(JSON.stringify(resultado)).not.toContain("constraint");
    expect(JSON.stringify(resultado)).not.toContain("SOL-001024");
  });

  it("exceção também vira failed, sem derrubar o chat", async () => {
    rpc.mockRejectedValue(new Error("connect ETIMEDOUT 10.0.0.1:5432"));

    const resultado = await createLectureRequest(PEDIDO);

    expect(resultado).toEqual({ status: "failed" });
    expect(JSON.stringify(resultado)).not.toContain("10.0.0.1");
  });

  it("invalid e failed são resultados DIFERENTES", async () => {
    // Confundir os dois faria o bot pedir para a pessoa reescrever uma resposta
    // que estava certa.
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });

    const falhou = await createLectureRequest(PEDIDO);
    const invalido = await createLectureRequest({ ...PEDIDO, city: "" });

    expect(falhou.status).toBe("failed");
    expect(invalido.status).toBe("invalid");
  });
});

/**
 * §58: abandono. A solicitação só existe quando alguém chama esta função — não
 * há rascunho, não há linha "em construção" no banco. Uma conversa abandonada
 * antes da confirmação não deixa nada para trás.
 */
describe("abandono antes da confirmação (§58)", () => {
  it("coletar dados não cria nada: só a chamada cria", async () => {
    expect(rpc).not.toHaveBeenCalled();

    await createLectureRequest(PEDIDO);

    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

/**
 * §60: consulta pelo protocolo. O protocolo é SEQUENCIAL e previsível — sem
 * amarrar a consulta a quem pediu, varrer de SOL-000001 a SOL-000999 devolveria
 * o mapa de quem pediu palestra para a APCS.
 */
describe("consulta pelo protocolo", () => {
  it("filtra pelo protocolo E pelo contato da conversa", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        id: "abc",
        protocol: "SOL-001024",
        origin: "chatbot",
        name: "João da Silva",
        theme: "Manejo sanitário",
        city: "Toledo",
        location: null,
        type: "company",
        type_other: null,
        format: null,
        event_date: "2026-09-20",
        start_time: "14:00:00",
        end_time: null,
        priority: "normal",
        status: "requested",
        requested_at: "2026-08-13T12:00:00Z",
        held_at: null,
        requester_contact_id: "99999999-9999-4999-8999-999999999999",
        created_at: "2026-08-13T12:00:00Z",
        updated_at: "2026-08-13T12:00:00Z",
      },
      error: null,
    });

    const resultado = await getLectureRequestByProtocol(
      "SOL-001024",
      "99999999-9999-4999-8999-999999999999",
    );

    expect(resultado.status).toBe("found");
    expect(eqCalls).toEqual([
      ["protocol", "SOL-001024"],
      ["requester_contact_id", "99999999-9999-4999-8999-999999999999"],
    ]);
  });

  it("o recorte devolvido não carrega nada interno", async () => {
    maybeSingle.mockResolvedValue({
      data: {
        id: "abc",
        protocol: "SOL-001024",
        origin: "chatbot",
        name: "João",
        theme: "Manejo",
        city: "Toledo",
        location: null,
        type: "company",
        type_other: null,
        format: null,
        event_date: "2026-09-20",
        start_time: null,
        end_time: null,
        priority: "urgent",
        status: "rejected",
        requested_at: "2026-08-13T12:00:00Z",
        held_at: null,
        requester_contact_id: "99999999-9999-4999-8999-999999999999",
        created_at: "2026-08-13T12:00:00Z",
        updated_at: "2026-08-13T12:00:00Z",
      },
      error: null,
    });

    const resultado = await getLectureRequestByProtocol(
      "SOL-001024",
      "99999999-9999-4999-8999-999999999999",
    );

    expect(resultado.status).toBe("found");
    if (resultado.status === "found") {
      const chaves = Object.keys(resultado.lecture);
      for (const proibida of [
        "priority",
        "notes",
        "rejectionReason",
        "cancellationReason",
        "responsible",
        "speaker",
        "createdBy",
        "updatedBy",
        "attendeesEstimated",
      ]) {
        expect(chaves).not.toContain(proibida);
      }
    }
  });

  it("protocolo malformado nem consulta o banco", async () => {
    const resultado = await getLectureRequestByProtocol(
      "SOL-1' OR '1'='1",
      "99999999-9999-4999-8999-999999999999",
    );

    expect(resultado).toEqual({ status: "not-found" });
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("contato malformado nem consulta o banco", async () => {
    const resultado = await getLectureRequestByProtocol("SOL-001024", "qualquer-coisa");

    expect(resultado).toEqual({ status: "not-found" });
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("protocolo de outra pessoa some como se não existisse", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });

    const resultado = await getLectureRequestByProtocol(
      "SOL-001024",
      "88888888-8888-4888-8888-888888888888",
    );

    // Os dois "nãos" — não existe, e existe mas não é seu — colapsam no mesmo
    // resultado: distinguir confirmaria a existência do protocolo a quem não
    // deveria saber dele.
    expect(resultado).toEqual({ status: "not-found" });
  });
});
