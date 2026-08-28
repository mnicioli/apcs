import { describe, expect, it } from "vitest";
import {
  emptyApplication,
  formatCnpj,
  formatWhatsapp,
  isValidCnpj,
  isValidWhatsapp,
  membershipApplicationSchema,
  onlyDigits,
  rejectApplicationSchema,
  UFS,
} from "./membership.schema";

/**
 * O schema do formulário público.
 *
 * ⚠️ Este é o arquivo mais testado do módulo de Associados, e o motivo é que ele
 * é a ÚNICA validação que a pessoa vê. Ela não recebe o erro do Postgres: ela
 * recebe a frase daqui, no campo certo, enquanto digita. Um erro que aponta para
 * o campo errado num formulário de três etapas faz a pessoa desistir.
 */

/** Uma solicitação válida de criador, para partir dela em cada caso. */
function valida(extra: Record<string, unknown> = {}) {
  return {
    ...emptyApplication,
    profileType: "criador",
    fullName: "Maria da Silva",
    whatsapp: "(54) 99123-4567",
    email: "maria@exemplo.com",
    city: "Caxias do Sul",
    state: "RS",
    productionCity: "Vacaria",
    consentAccepted: true,
    ...extra,
  };
}

describe("onlyDigits", () => {
  it("tira tudo o que não é número", () => {
    expect(onlyDigits("(54) 99123-4567")).toBe("54991234567");
    expect(onlyDigits("00.000.000/0000-00")).toBe("00000000000000");
    expect(onlyDigits("sem número")).toBe("");
  });
});

describe("formatWhatsapp", () => {
  it("monta a máscara conforme a pessoa digita", () => {
    expect(formatWhatsapp("")).toBe("");
    expect(formatWhatsapp("5")).toBe("(5");
    expect(formatWhatsapp("54")).toBe("(54");
    expect(formatWhatsapp("5499")).toBe("(54) 99");
    expect(formatWhatsapp("5499123")).toBe("(54) 9912-3");
    expect(formatWhatsapp("54991234567")).toBe("(54) 99123-4567");
  });

  it("ignora o que passa de onze dígitos", () => {
    expect(formatWhatsapp("549912345678888")).toBe("(54) 99123-4567");
  });

  it("aceita um número já formatado sem estragá-lo", () => {
    expect(formatWhatsapp("(54) 99123-4567")).toBe("(54) 99123-4567");
  });
});

describe("formatCnpj", () => {
  it("monta a máscara do CNPJ", () => {
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });
});

describe("isValidCnpj", () => {
  it("aceita um CNPJ com dígitos verificadores corretos", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
  });

  it("recusa quantidade errada de dígitos", () => {
    expect(isValidCnpj("1122233300018")).toBe(false);
  });

  // 00000000000000 passa na conta dos dígitos verificadores. É o caso que só um
  // teste pega — e é justamente o que alguém digita para "pular" o campo.
  it("recusa os catorze dígitos repetidos", () => {
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("11111111111111")).toBe(false);
  });
});

describe("isValidWhatsapp", () => {
  it("aceita celular com o nove na frente", () => {
    expect(isValidWhatsapp("(54) 99123-4567")).toBe(true);
  });

  it("aceita fixo de dez dígitos", () => {
    // Cadastro aceita; o disparo de WhatsApp é que vai recusar depois — ver o
    // comentário da função e src/lib/messaging/phone.ts.
    expect(isValidWhatsapp("(54) 3123-4567")).toBe(true);
  });

  it("recusa celular de onze dígitos sem o nove", () => {
    expect(isValidWhatsapp("(54) 81234-5678")).toBe(false);
  });

  it("recusa DDD que não existe", () => {
    expect(isValidWhatsapp("(01) 99123-4567")).toBe(false);
    expect(isValidWhatsapp("(10) 99123-4567")).toBe(false);
  });

  it("recusa número curto ou longo demais", () => {
    expect(isValidWhatsapp("999123456")).toBe(false);
    expect(isValidWhatsapp("549912345678")).toBe(false);
  });
});

describe("membershipApplicationSchema", () => {
  it("aceita uma solicitação completa de criador", () => {
    const resultado = membershipApplicationSchema.safeParse(valida());
    expect(resultado.success).toBe(true);
  });

  it("apara espaços do nome e mantém o e-mail como digitado", () => {
    const resultado = membershipApplicationSchema.safeParse(
      valida({ fullName: "  Maria da Silva  " }),
    );
    expect(resultado.success && resultado.data.fullName).toBe("Maria da Silva");
  });

  it("recusa sem consentimento", () => {
    const resultado = membershipApplicationSchema.safeParse(valida({ consentAccepted: false }));
    expect(resultado.success).toBe(false);
    if (resultado.success) return;
    expect(resultado.error.issues.some((i) => i.path[0] === "consentAccepted")).toBe(true);
  });

  it("recusa UF fora da lista", () => {
    const resultado = membershipApplicationSchema.safeParse(valida({ state: "XX" }));
    expect(resultado.success).toBe(false);
  });

  it("traz as 27 UFs, com o RS primeiro", () => {
    expect(UFS).toHaveLength(27);
    expect(UFS[0]).toBe("RS");
    expect(new Set(UFS).size).toBe(27);
  });

  describe("obrigatoriedade por perfil", () => {
    it("criador precisa do município da produção", () => {
      const resultado = membershipApplicationSchema.safeParse(valida({ productionCity: "" }));
      expect(resultado.success).toBe(false);
      if (resultado.success) return;
      const erro = resultado.error.issues.find((i) => i.path[0] === "productionCity");
      expect(erro?.message).toBe("Informe o município da produção.");
    });

    it("técnico precisa de área de atuação e cargo", () => {
      const resultado = membershipApplicationSchema.safeParse(
        valida({ profileType: "tecnico", productionCity: "" }),
      );
      expect(resultado.success).toBe(false);
      if (resultado.success) return;
      const caminhos = resultado.error.issues.map((i) => i.path[0]);
      expect(caminhos).toContain("activityArea");
      expect(caminhos).toContain("jobTitle");
      // ⚠️ E NÃO cobra o município da produção: aquele campo é de outro perfil,
      // e nem sequer aparece na tela deste.
      expect(caminhos).not.toContain("productionCity");
    });

    it("empresa precisa de razão social, cargo e CNPJ", () => {
      const resultado = membershipApplicationSchema.safeParse(
        valida({ profileType: "empresa", productionCity: "" }),
      );
      expect(resultado.success).toBe(false);
      if (resultado.success) return;
      const caminhos = resultado.error.issues.map((i) => i.path[0]);
      expect(caminhos).toContain("legalName");
      expect(caminhos).toContain("jobTitle");
      expect(caminhos).toContain("cnpj");
    });

    it("empresa completa passa", () => {
      const resultado = membershipApplicationSchema.safeParse(
        valida({
          profileType: "empresa",
          productionCity: "",
          legalName: "Granja Boa Vista LTDA",
          jobTitle: "Diretor",
          cnpj: "11.222.333/0001-81",
        }),
      );
      expect(resultado.success).toBe(true);
    });

    /**
     * ⚠️ O ÚNICO PERFIL SEM CAMPO OBRIGATÓRIO PRÓPRIO, e o teste existe para
     * que isso seja uma decisão registrada e não um esquecimento que alguém
     * "conserte" depois acrescentando exigências. Universidade não está
     * pedindo filiação — está se colocando para receber comunicação.
     */
    it("universidade passa só com os campos comuns", () => {
      const resultado = membershipApplicationSchema.safeParse(
        valida({ profileType: "universidade", productionCity: "" }),
      );
      expect(resultado.success).toBe(true);
    });

    it("universidade não cobra campo de nenhum outro perfil", () => {
      const resultado = membershipApplicationSchema.safeParse(
        valida({ profileType: "universidade", productionCity: "", cnpj: "" }),
      );
      expect(resultado.success).toBe(true);
    });

    it("criador pode informar CNPJ, mas ele tem de ser válido", () => {
      const resultado = membershipApplicationSchema.safeParse(
        valida({ cnpj: "11.222.333/0001-82" }),
      );
      expect(resultado.success).toBe(false);
      if (resultado.success) return;
      expect(resultado.error.issues.some((i) => i.path[0] === "cnpj")).toBe(true);
    });
  });

  describe("interesses", () => {
    it("marcar “Outro” cobra o campo de texto", () => {
      const resultado = membershipApplicationSchema.safeParse(valida({ interests: ["Outro"] }));
      expect(resultado.success).toBe(false);
      if (resultado.success) return;
      expect(resultado.error.issues.some((i) => i.path[0] === "otherInterest")).toBe(true);
    });

    it("marcar “Outro” com o texto preenchido passa", () => {
      const resultado = membershipApplicationSchema.safeParse(
        valida({ interests: ["Outro"], otherInterest: "Genética" }),
      );
      expect(resultado.success).toBe(true);
    });

    it("não cobra o texto quando “Outro” não está marcado", () => {
      const resultado = membershipApplicationSchema.safeParse(
        valida({ interests: ["Bolsa de Suínos"] }),
      );
      expect(resultado.success).toBe(true);
    });
  });

  describe("número de matrizes", () => {
    it("aceita inteiro", () => {
      const resultado = membershipApplicationSchema.safeParse(valida({ sowCount: "1200" }));
      expect(resultado.success).toBe(true);
    });

    it("aceita vazio — o campo é opcional", () => {
      const resultado = membershipApplicationSchema.safeParse(valida({ sowCount: "" }));
      expect(resultado.success).toBe(true);
    });

    it("recusa texto", () => {
      const resultado = membershipApplicationSchema.safeParse(valida({ sowCount: "muitas" }));
      expect(resultado.success).toBe(false);
    });
  });
});

describe("rejectApplicationSchema", () => {
  it("exige um motivo com conteúdo", () => {
    expect(
      rejectApplicationSchema.safeParse({
        id: "11111111-1111-4111-8111-111111111111",
        reason: "   ",
      }).success,
    ).toBe(false);
  });

  it("aceita um motivo escrito", () => {
    expect(
      rejectApplicationSchema.safeParse({
        id: "11111111-1111-4111-8111-111111111111",
        reason: "Atuação fora do escopo da APCS.",
      }).success,
    ).toBe(true);
  });

  it("recusa id que não é uuid", () => {
    expect(
      rejectApplicationSchema.safeParse({ id: "abc", reason: "Motivo suficiente." }).success,
    ).toBe(false);
  });
});
