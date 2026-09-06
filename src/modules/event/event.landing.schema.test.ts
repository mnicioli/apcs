import { describe, expect, it } from "vitest";
import {
  createLandingPageSchema,
  createRegistrationSchema,
  landingCommandSchema,
  landingFieldsSchema,
  onlyDigits,
  participantSchema,
  publicRegistrationSchema,
  registrationFormSchema,
  updateRegistrationSchema,
} from "./event.landing.schema";
import { MAX_PARTICIPANTS_PER_REGISTRATION } from "./event.landing.types";

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

  /** O evento é obrigatório desde o Prompt 4 — ver o caso de IDOR logo abaixo. */
  const evento = "22222222-2222-4222-8222-222222222222";

  it("aceita só a situação, só o nome, ou os dois", () => {
    expect(
      updateRegistrationSchema.safeParse({ eventId: evento, registrationId: id }).success,
    ).toBe(true);
    expect(
      updateRegistrationSchema.safeParse({
        eventId: evento,
        registrationId: id,
        status: "cancelled",
      }).success,
    ).toBe(true);
    expect(
      updateRegistrationSchema.safeParse({
        eventId: evento,
        registrationId: id,
        companyName: "Granja XYZ",
      }).success,
    ).toBe(true);
  });

  /**
   * ============================================================================
   * ⚠️ SEM O EVENTO, NÃO PASSA — E É O §26 DO PROMPT 4 (IDOR).
   * ============================================================================
   * A cadeia Evento → Landing Page → Inscrição → Participante é conferida no
   * BANCO, e a função só consegue conferi-la se receber o evento. Este caso
   * existe para que remover o campo "porque a tela já sabe qual evento é" quebre
   * a bateria em vez de abrir silenciosamente a porta para um id de outro
   * evento colado na requisição.
   */
  it("recusa a edição sem o evento", () => {
    expect(updateRegistrationSchema.safeParse({ registrationId: id }).success).toBe(false);
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

/* ========================================================================== */
/* §15, §19 e §35 do Prompt 3 — o payload da página pública                   */
/* ========================================================================== */

describe("publicRegistrationSchema", () => {
  const valido = {
    slug: "encontro-tecnico",
    companyName: "Granja ABC",
    participants: [
      {
        fullName: "João da Silva",
        email: "joao@email.com",
        phone: "(11) 99999-8888",
        whatsapp: "",
      },
    ],
    consentVersion: "2026-08-v1",
    consentAccepted: true,
  };

  it("aceita uma inscrição completa", () => {
    const r = publicRegistrationSchema.safeParse(valido);
    expect(r.success).toBe(true);
  });

  /**
   * ⚠️ ELE MANDA O SLUG, E NÃO O `landingPageId`. É a diferença entre a porta
   * pública e a do backoffice: o navegador nunca recebe o id, então não há id
   * para forjar. Um `landingPageId` que voltasse a este schema seria o sinal de
   * que a proteção foi desfeita.
   */
  it("não tem landingPageId", () => {
    expect("landingPageId" in valido).toBe(false);
    const comId = publicRegistrationSchema.safeParse({
      ...valido,
      landingPageId: "11111111-1111-4111-8111-111111111111",
    });
    // O Zod ignora chave extra — o que importa é que ela não sai do outro lado.
    expect(comId.success).toBe(true);
    if (comId.success) expect("landingPageId" in comId.data).toBe(false);
  });

  it("recusa endereço de página malformado", () => {
    for (const slug of ["", "ab", "Encontro Técnico", "encontro--tecnico", "-encontro"]) {
      expect(publicRegistrationSchema.safeParse({ ...valido, slug }).success).toBe(false);
    }
  });

  /* --- §15: os obrigatórios ------------------------------------------------ */

  it("exige granja/empresa", () => {
    const r = publicRegistrationSchema.safeParse({ ...valido, companyName: " " });
    expect(r.success).toBe(false);
  });

  it("exige nome e e-mail de cada participante", () => {
    const semNome = publicRegistrationSchema.safeParse({
      ...valido,
      participants: [{ ...valido.participants[0], fullName: "" }],
    });
    const semEmail = publicRegistrationSchema.safeParse({
      ...valido,
      participants: [{ ...valido.participants[0], email: "" }],
    });
    expect(semNome.success).toBe(false);
    expect(semEmail.success).toBe(false);
  });

  it("recusa e-mail inválido", () => {
    const r = publicRegistrationSchema.safeParse({
      ...valido,
      participants: [{ ...valido.participants[0], email: "joao@email" }],
    });
    expect(r.success).toBe(false);
  });

  /* --- §10 e §15: telefone OU WhatsApp ------------------------------------- */

  it("aceita só telefone, só WhatsApp, e os dois", () => {
    const casos = [
      { phone: "11999998888", whatsapp: "" },
      { phone: "", whatsapp: "11988887777" },
      { phone: "11999998888", whatsapp: "11988887777" },
    ];
    for (const contato of casos) {
      const r = publicRegistrationSchema.safeParse({
        ...valido,
        participants: [{ ...valido.participants[0], ...contato }],
      });
      expect(r.success, JSON.stringify(contato)).toBe(true);
    }
  });

  it("recusa participante sem nenhum dos dois", () => {
    const r = publicRegistrationSchema.safeParse({
      ...valido,
      participants: [{ ...valido.participants[0], phone: "", whatsapp: "" }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      // O erro pousa no campo de telefone: é o primeiro dos dois vazios, e é
      // onde a pessoa está olhando.
      expect(r.error.issues.some((i) => i.path.join(".") === "participants.0.phone")).toBe(true);
    }
  });
});

describe("§19 — o mesmo e-mail duas vezes na mesma inscrição", () => {
  const base = {
    slug: "encontro-tecnico",
    companyName: "Granja ABC",
    consentVersion: "2026-08-v1",
    consentAccepted: true,
  };

  const pessoa = (email: string) => ({
    fullName: "Alguém da Granja",
    email,
    phone: "11999998888",
    whatsapp: "",
  });

  it("recusa, e aponta para a SEGUNDA linha", () => {
    const r = publicRegistrationSchema.safeParse({
      ...base,
      participants: [pessoa("joao@email.com"), pessoa("joao@email.com")],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const caminhos = r.error.issues.map((i) => i.path.join("."));
      // Quem digitou a segunda é quem precisa corrigi-la — culpar a primeira
      // mandaria a pessoa mexer na linha que estava certa.
      expect(caminhos).toContain("participants.1.email");
      expect(caminhos).not.toContain("participants.0.email");
    }
  });

  /**
   * ⚠️ §16 — "Joao@Email.com" e "joao@email.com" são A MESMA PESSOA. Sem o
   * `toLowerCase` do schema, esta inscrição passaria aqui e morreria no índice
   * único do banco com uma violação de constraint, que não sabe dizer qual
   * e-mail é o problema.
   */
  it("compara sem distinguir maiúsculas", () => {
    const r = publicRegistrationSchema.safeParse({
      ...base,
      participants: [pessoa("Joao@Email.com"), pessoa("joao@email.com")],
    });
    expect(r.success).toBe(false);
  });

  it("aceita e-mails diferentes", () => {
    const r = publicRegistrationSchema.safeParse({
      ...base,
      participants: [pessoa("joao@email.com"), pessoa("maria@email.com")],
    });
    expect(r.success).toBe(true);
  });
});

describe("§35 — o consentimento", () => {
  const base = {
    slug: "encontro-tecnico",
    companyName: "Granja ABC",
    participants: [
      { fullName: "João da Silva", email: "joao@email.com", phone: "11999998888", whatsapp: "" },
    ],
    consentVersion: "2026-08-v1",
  };

  it("recusa o envio sem o aceite", () => {
    const r = publicRegistrationSchema.safeParse({ ...base, consentAccepted: false });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join(".") === "consentAccepted")).toBe(true);
    }
  });

  it("recusa versão de consentimento malformada", () => {
    for (const consentVersion of ["", "ab", "versão com espaço", "x".repeat(41)]) {
      const r = publicRegistrationSchema.safeParse({
        ...base,
        consentVersion,
        consentAccepted: true,
      });
      expect(r.success, consentVersion).toBe(false);
    }
  });
});

describe("§13 — o teto de participantes por inscrição", () => {
  /**
   * ⚠️ A CONSTANTE E O SCHEMA CONCORDAM PORQUE SÃO A MESMA COISA. A tela usa
   * `MAX_PARTICIPANTS_PER_REGISTRATION` para parar de oferecer o botão; o schema
   * usa a mesma constante para recusar. Se a tela repetisse o número, uma das
   * duas ficaria para trás — e o sintoma seria um botão que adiciona uma linha
   * que o envio recusa.
   */
  it("aceita exatamente o teto e recusa um a mais", () => {
    const pessoa = (i: number) => ({
      fullName: `Pessoa ${i}`,
      email: `p${i}@email.com`,
      phone: "11999998888",
      whatsapp: "",
    });
    const base = {
      slug: "encontro-tecnico",
      companyName: "Granja ABC",
      consentVersion: "2026-08-v1",
      consentAccepted: true,
    };

    const noTeto = Array.from({ length: MAX_PARTICIPANTS_PER_REGISTRATION }, (_, i) => pessoa(i));
    expect(publicRegistrationSchema.safeParse({ ...base, participants: noTeto }).success).toBe(
      true,
    );

    const acima = [...noTeto, pessoa(MAX_PARTICIPANTS_PER_REGISTRATION)];
    expect(publicRegistrationSchema.safeParse({ ...base, participants: acima }).success).toBe(
      false,
    );
  });
});
