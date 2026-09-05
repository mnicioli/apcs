import { describe, expect, it } from "vitest";
import {
  createLandingPageSchema,
  createRegistrationSchema,
  landingCommandSchema,
  landingFieldsSchema,
  onlyDigits,
  participantSchema,
  registrationFormSchema,
  updateRegistrationSchema,
} from "./event.landing.schema";

/**
 * Os contratos de entrada — e o que cada um recusa.
 *
 * ⚠️ CADA REGRA AQUI TEM UMA GÊMEA NO POSTGRES, e é a gêmea que garante. O §17
 * é explícito: "Não confiar somente nas validações do frontend." Estes testes
 * provam que a camada que fala português recusa as MESMAS coisas que o banco —
 * porque uma regra que só o banco conhece chega ao usuário como violação de
 * constraint, e uma que só o Zod conhece não vale nada contra uma chamada
 * direta ao PostgREST.
 */

function participante(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "João da Silva",
    email: "joao@granja.com",
    phone: "",
    whatsapp: "45999990000",
    ...overrides,
  };
}

describe("participante (§8)", () => {
  it("aceita com WhatsApp e sem telefone", () => {
    expect(participantSchema.safeParse(participante()).success).toBe(true);
  });

  it("aceita com telefone e sem WhatsApp", () => {
    const resultado = participantSchema.safeParse(
      participante({ phone: "4532223333", whatsapp: "" }),
    );
    expect(resultado.success).toBe(true);
  });

  it("aceita com os dois", () => {
    const resultado = participantSchema.safeParse(
      participante({ phone: "4532223333", whatsapp: "45999990000" }),
    );
    expect(resultado.success).toBe(true);
  });

  /**
   * ⚠️ O §8 INTEIRO ESTÁ NESTE TESTE. Telefone e WhatsApp são opcionais um a
   * um, e a regra só existe olhando os dois juntos — por isso ela é um `refine`
   * de OBJETO, e não de campo. O gêmeo no banco é o CHECK
   * `event_participants_needs_a_phone`.
   */
  it("recusa sem telefone E sem WhatsApp", () => {
    const resultado = participantSchema.safeParse(participante({ phone: "", whatsapp: "" }));
    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      // O erro aponta para o campo de telefone, e não fica solto no objeto:
      // sem `path`, a tela teria de inventar onde mostrá-lo.
      expect(resultado.error.issues[0]?.path).toEqual(["phone"]);
    }
  });

  it("recusa nome vazio e e-mail inválido", () => {
    expect(participantSchema.safeParse(participante({ fullName: "" })).success).toBe(false);
    expect(participantSchema.safeParse(participante({ email: "não-é-email" })).success).toBe(false);
  });

  /**
   * ⚠️ NÃO É COSMÉTICO: é disso que depende o índice único do §12. "Joao@x.com"
   * e "joao@x.com" são a mesma pessoa, e um índice sobre o valor cru deixaria
   * as duas entrarem no mesmo evento.
   */
  it("guarda o e-mail em minúsculas", () => {
    const resultado = participantSchema.safeParse(participante({ email: "  Joao@Granja.COM " }));
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.email).toBe("joao@granja.com");
  });

  it("guarda o telefone só com dígitos", () => {
    const resultado = participantSchema.safeParse(
      participante({ phone: "(45) 3222-3333", whatsapp: "" }),
    );
    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.phone).toBe("4532223333");
  });

  it("recusa telefone curto demais para ter DDD", () => {
    const resultado = participantSchema.safeParse(
      participante({ phone: "32223333", whatsapp: "" }),
    );
    expect(resultado.success).toBe(false);
  });

  it("onlyDigits aguenta nulo e indefinido", () => {
    expect(onlyDigits(null)).toBe("");
    expect(onlyDigits(undefined)).toBe("");
    expect(onlyDigits("+55 (45) 99999-0000")).toBe("5545999990000");
  });
});

describe("inscrição (§12, §17)", () => {
  it("aceita uma granja com quatro participantes", () => {
    const resultado = registrationFormSchema.safeParse({
      companyName: "Granja ABC",
      participants: [
        participante({ email: "joao@granja.com" }),
        participante({ fullName: "Maria da Silva", email: "maria@granja.com" }),
        participante({ fullName: "Carlos da Silva", email: "carlos@granja.com" }),
        participante({ fullName: "Fernanda Silva", email: "fernanda@granja.com" }),
      ],
    });
    expect(resultado.success).toBe(true);
  });

  it("recusa sem granja", () => {
    const resultado = registrationFormSchema.safeParse({
      companyName: "",
      participants: [participante()],
    });
    expect(resultado.success).toBe(false);
  });

  it("recusa sem nenhum participante", () => {
    const resultado = registrationFormSchema.safeParse({
      companyName: "Granja ABC",
      participants: [],
    });
    expect(resultado.success).toBe(false);
  });

  /**
   * ⚠️ A METADE INTERNA DO §12 — o exemplo literal do escopo:
   * "João - joao@email.com / Maria - joao@email.com" é inválido.
   *
   * A outra metade (contra as inscrições que JÁ existem no evento) não pode ser
   * feita aqui: ela precisa do banco, e está na etapa 7 de
   * `create_event_registration`, com o índice único como garantia final.
   */
  it("recusa e-mail repetido dentro da mesma inscrição", () => {
    const resultado = registrationFormSchema.safeParse({
      companyName: "Granja ABC",
      participants: [
        participante({ fullName: "João", email: "joao@email.com" }),
        participante({ fullName: "Maria", email: "joao@email.com" }),
      ],
    });

    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      // Aponta para a LINHA REPETIDA, e não para a primeira: quem digitou a
      // segunda é quem precisa corrigi-la.
      expect(resultado.error.issues[0]?.path).toEqual(["participants", 1, "email"]);
    }
  });

  it("a repetição é detectada mesmo com caixa e espaço diferentes", () => {
    const resultado = registrationFormSchema.safeParse({
      companyName: "Granja ABC",
      participants: [
        participante({ email: "joao@email.com" }),
        participante({ fullName: "Maria", email: "  JOAO@EMAIL.COM  " }),
      ],
    });
    expect(resultado.success).toBe(false);
  });

  /**
   * ⚠️ A MESMA REGRA VALE NAS DUAS FORMAS DO SCHEMA. `createRegistrationSchema`
   * acrescenta `landingPageId` ao objeto base — e, no Zod 3, encadear
   * `superRefine` antes de `extend` seria impossível. Este teste é o que
   * garante que a extensão não perdeu a verificação pelo caminho.
   */
  it("o schema da action herda a regra de e-mail repetido", () => {
    const resultado = createRegistrationSchema.safeParse({
      landingPageId: "11111111-1111-4111-8111-111111111111",
      companyName: "Granja ABC",
      participants: [
        participante({ email: "joao@email.com" }),
        participante({ fullName: "Maria", email: "joao@email.com" }),
      ],
    });
    expect(resultado.success).toBe(false);
  });

  it("o schema da action exige um landingPageId que seja uuid", () => {
    const resultado = createRegistrationSchema.safeParse({
      landingPageId: "não-é-uuid",
      companyName: "Granja ABC",
      participants: [participante()],
    });
    expect(resultado.success).toBe(false);
  });

  /**
   * Teto de tamanho de payload (§28), não regra de negócio. Generoso o
   * bastante para a maior granja da base.
   */
  it("recusa uma inscrição com mais de 200 participantes", () => {
    const gente = Array.from({ length: 201 }, (_, i) =>
      participante({ email: `pessoa${i}@granja.com` }),
    );
    const resultado = registrationFormSchema.safeParse({
      companyName: "Granja ABC",
      participants: gente,
    });
    expect(resultado.success).toBe(false);
  });
});

describe("landing page", () => {
  const CAMPOS = ["GRANJA_EMPRESA", "EMAIL", "NOME_PARTICIPANTE", "TELEFONE", "WHATSAPP"];

  function form(overrides: Record<string, unknown> = {}) {
    return {
      eventId: "11111111-1111-4111-8111-111111111111",
      slug: "",
      description: "",
      formFields: CAMPOS,
      successTitle: "",
      successMessage: "",
      successFooter: "",
      closesAt: "",
      maxParticipants: "",
      ...overrides,
    };
  }

  it("aceita o formulário vazio: tudo é opcional além dos campos", () => {
    expect(createLandingPageSchema.safeParse(form()).success).toBe(true);
  });

  /**
   * Vazio significa "gera a partir do nome do evento" (§6) — quem decide é o
   * banco, que é o único que consegue conferir a unicidade.
   */
  it("slug vazio é permitido", () => {
    expect(createLandingPageSchema.safeParse(form({ slug: "" })).success).toBe(true);
  });

  it("slug digitado é normalizado para minúsculas e conferido", () => {
    const bom = createLandingPageSchema.safeParse(form({ slug: "Encontro-Tecnico" }));
    expect(bom.success).toBe(true);
    if (bom.success) expect(bom.data.slug).toBe("encontro-tecnico");

    expect(createLandingPageSchema.safeParse(form({ slug: "com espaço" })).success).toBe(false);
    expect(createLandingPageSchema.safeParse(form({ slug: "ab" })).success).toBe(false);
  });

  it("recusa a configuração de campos que deixaria a página incapaz de aceitar inscrição", () => {
    const semContato = createLandingPageSchema.safeParse(
      form({ formFields: ["GRANJA_EMPRESA", "EMAIL", "NOME_PARTICIPANTE"] }),
    );
    expect(semContato.success).toBe(false);
    if (!semContato.success) {
      expect(semContato.error.issues[0]?.message).toContain("Telefone ou WhatsApp");
    }
  });

  it("recusa campo desconhecido", () => {
    expect(
      createLandingPageSchema.safeParse(form({ formFields: [...CAMPOS, "CPF"] })).success,
    ).toBe(false);
  });

  it("a lista de campos sozinha também é validada — é o que o Builder vai usar", () => {
    expect(landingFieldsSchema.safeParse(CAMPOS).success).toBe(true);
    expect(landingFieldsSchema.safeParse([]).success).toBe(false);
  });

  /**
   * ⚠️ ZERO É RECUSADO, e o CHECK `event_landing_pages_capacity` recusa igual.
   * Uma página publicada com capacidade zero recusaria todo mundo sem dizer por
   * quê — quem quer isso encerra a página.
   */
  it("capacidade vazia é sem limite; zero é recusado", () => {
    expect(createLandingPageSchema.safeParse(form({ maxParticipants: "" })).success).toBe(true);
    expect(createLandingPageSchema.safeParse(form({ maxParticipants: "100" })).success).toBe(true);
    expect(createLandingPageSchema.safeParse(form({ maxParticipants: "0" })).success).toBe(false);
    expect(createLandingPageSchema.safeParse(form({ maxParticipants: "-5" })).success).toBe(false);
    expect(createLandingPageSchema.safeParse(form({ maxParticipants: "cem" })).success).toBe(false);
  });

  it("prazo vazio é sem prazo; data ilegível é recusada", () => {
    expect(createLandingPageSchema.safeParse(form({ closesAt: "" })).success).toBe(true);
    expect(
      createLandingPageSchema.safeParse(form({ closesAt: "2026-09-17T23:59:00-03:00" })).success,
    ).toBe(true);
    expect(createLandingPageSchema.safeParse(form({ closesAt: "ontem" })).success).toBe(false);
  });

  /**
   * ⚠️ SEM MÍNIMO NOS TEXTOS DE CONFIRMAÇÃO, e é deliberado: vazio significa
   * "usa o padrão da plataforma" (§18). Exigir dois caracteres impediria de
   * LIMPAR o campo para voltar ao padrão.
   */
  it("mensagem de sucesso vazia é permitida — é assim que se volta ao padrão", () => {
    expect(createLandingPageSchema.safeParse(form({ successTitle: "" })).success).toBe(true);
  });

  it("os comandos de situação são só os três", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    for (const command of ["publish", "close", "deactivate"]) {
      expect(landingCommandSchema.safeParse({ landingPageId: id, command }).success).toBe(true);
    }
    expect(landingCommandSchema.safeParse({ landingPageId: id, command: "delete" }).success).toBe(
      false,
    );
  });
});

describe("edição da inscrição pelo backoffice", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("aceita só a situação, só o nome, ou os dois", () => {
    expect(updateRegistrationSchema.safeParse({ registrationId: id }).success).toBe(true);
    expect(
      updateRegistrationSchema.safeParse({ registrationId: id, status: "cancelled" }).success,
    ).toBe(true);
    expect(
      updateRegistrationSchema.safeParse({ registrationId: id, companyName: "Granja XYZ" }).success,
    ).toBe(true);
  });

  /**
   * ⚠️ NÃO EXISTE "EXCLUIR" NO VOCABULÁRIO (§13). As duas situações são as
   * únicas, e o `delete` não é uma delas nem por engano de digitação.
   */
  it("recusa uma situação que não existe", () => {
    expect(
      updateRegistrationSchema.safeParse({ registrationId: id, status: "deleted" }).success,
    ).toBe(false);
  });
});
