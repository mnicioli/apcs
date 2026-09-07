import { describe, expect, it } from "vitest";
import {
  formatPhoneInput,
  formatWhatsapp,
  MAX_PHONE_DIGITS,
  MIN_PHONE_DIGITS,
  onlyDigits,
} from "./phone";
import { participantSchema } from "@/modules/event/event.landing.schema";

/** Um participante válido, para variar só o telefone. */
function pessoa(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "João da Silva",
    email: "joao@granja.com",
    phone: "",
    whatsapp: "45999990000",
    ...overrides,
  };
}

/**
 * §17 do Prompt 3 — "utilizar os formatadores existentes" E "preservar a
 * capacidade internacional".
 *
 * As duas exigências puxam para lados opostos, e é isso que estes testes fixam.
 */

describe("onlyDigits", () => {
  it("tira máscara, espaço e sinal", () => {
    expect(onlyDigits("(11) 99999-8888")).toBe("11999998888");
    expect(onlyDigits("+55 11 99999-8888")).toBe("5511999998888");
  });

  it("aguenta nulo e indefinido", () => {
    expect(onlyDigits(null)).toBe("");
    expect(onlyDigits(undefined)).toBe("");
  });

  /**
   * ⚠️ A CONSOLIDAÇÃO DE DUAS CÓPIAS. `membership.schema.ts` usava `/\D+/g` e
   * `event.landing.schema.ts` usava `/\D/g`. Este caso é o que prova que as
   * duas sempre deram o mesmo resultado — e é por isso que juntá-las não mudou
   * comportamento nenhum.
   */
  it("colapsar ou não os não-dígitos dá no mesmo", () => {
    const bruto = "+55 (11) 9.9999--8888 ";
    expect(onlyDigits(bruto)).toBe(bruto.replace(/\D/g, ""));
  });
});

describe("formatWhatsapp — a máscara brasileira", () => {
  it("monta o formato conforme a pessoa digita", () => {
    expect(formatWhatsapp("")).toBe("");
    expect(formatWhatsapp("1")).toBe("(1");
    expect(formatWhatsapp("11")).toBe("(11");
    expect(formatWhatsapp("1199")).toBe("(11) 99");
    expect(formatWhatsapp("1133334444")).toBe("(11) 3333-4444");
    expect(formatWhatsapp("11999998888")).toBe("(11) 99999-8888");
  });

  it("corta no décimo primeiro dígito", () => {
    expect(formatWhatsapp("119999988889999")).toBe("(11) 99999-8888");
  });
});

describe("formatPhoneInput — a máscara do formulário público", () => {
  /**
   * Até onze dígitos ela É `formatWhatsapp`. É a metade "reutilizar o que
   * existe" do §17: nada de máscara nova para número brasileiro.
   */
  it("usa a máscara existente para número nacional", () => {
    for (const bruto of ["11", "1199", "1133334444", "11999998888"]) {
      expect(formatPhoneInput(bruto)).toBe(formatWhatsapp(bruto));
    }
  });

  /**
   * ==========================================================================
   * ⚠️ O CASO QUE JUSTIFICA A FUNÇÃO EXISTIR.
   * ==========================================================================
   * `phoneSchema` aceita de 10 a 15 dígitos — o teto do E.164 — para não
   * recusar um número estrangeiro. Mascarar com `formatWhatsapp` cortaria em 11
   * e o formulário passaria a RECUSAR um telefone que a pessoa digitou certo,
   * sem dizer por quê: o campo simplesmente pararia de aceitar teclas.
   *
   * Um número português tem 12 dígitos com o código do país; um americano com
   * DDI tem 11 e ainda caberia por acidente.
   */
  it("não corta número internacional", () => {
    expect(formatPhoneInput("+351 912 345 678")).toBe("351912345678");
    expect(formatPhoneInput("+55 11 99999-8888")).toBe("5511999998888");
  });

  /**
   * ⚠️ A TRANSIÇÃO É O QUE SE QUEBRA SEM PERCEBER. No 11º dígito ainda há
   * máscara; no 12º ela some. Digitar continua funcionando nos dois sentidos
   * porque a função lê o valor CRU e não o formatado.
   */
  it("atravessa a fronteira dos onze dígitos nos dois sentidos", () => {
    expect(formatPhoneInput("11999998888")).toBe("(11) 99999-8888");
    expect(formatPhoneInput("(11) 99999-88881")).toBe("119999988881");
    // E voltar (apagar um dígito) devolve a máscara.
    expect(formatPhoneInput("11999998888")).toBe("(11) 99999-8888");
  });
});

/**
 * ============================================================================
 * ⚠️ O TETO DA MÁSCARA — E POR QUE ELE NÃO É UM `maxLength` NO `<input>`.
 * ============================================================================
 * Sem corte, o campo aceitava quarenta algarismos e o erro só aparecia no ENVIO,
 * vindo do `phoneSchema`, depois de a pessoa ter preenchido a inscrição inteira.
 *
 * A solução aparentemente óbvia — `maxLength={15}` no `<input>` — é a errada, e
 * o motivo está na conta: `maxLength` conta CARACTERES, e a máscara brasileira
 * completa, `(11) 99999-9999`, tem exatamente 15. O navegador bloquearia a
 * digitação do 12º dígito, que é justamente onde um número estrangeiro começa a
 * existir. O corte precisa ser em DÍGITOS, e por isso mora aqui.
 */
describe("formatPhoneInput — o teto de 15 dígitos", () => {
  it("para no máximo do E.164 e ignora o resto", () => {
    expect(formatPhoneInput("1".repeat(40))).toBe("1".repeat(MAX_PHONE_DIGITS));
    expect(onlyDigits(formatPhoneInput("1".repeat(40)))).toHaveLength(MAX_PHONE_DIGITS);
  });

  it("o maior número que o schema aceita ainda passa inteiro", () => {
    const quinze = "123456789012345";
    expect(quinze).toHaveLength(MAX_PHONE_DIGITS);
    expect(formatPhoneInput(quinze)).toBe(quinze);
  });

  /**
   * ⚠️ O CORTE É EM DÍGITOS, NÃO EM CARACTERES. Um número brasileiro colado com
   * máscara tem 15 caracteres e 11 dígitos — cortar por caractere devolveria o
   * mesmo texto por coincidência, e um estrangeiro de 12 dígitos colado com
   * espaços perderia algarismos.
   */
  it("pontuação não consome o limite", () => {
    expect(formatPhoneInput("(11) 99999-8888")).toBe("(11) 99999-8888");
    expect(formatPhoneInput("+351 912 345 678 90")).toBe("35191234567890");
  });

  /**
   * ⚠️ A MÁSCARA PARA ONDE A VALIDAÇÃO PARA. Se um dos dois lados mudar sozinho,
   * o campo passa a deixar digitar o que o servidor recusa — ou a recusar o que
   * ele aceitaria. É por isso que o número mora num lugar só.
   */
  it("o teto da máscara é o mesmo teto do phoneSchema", () => {
    const noLimite = "1".repeat(MAX_PHONE_DIGITS);
    const acima = "1".repeat(MAX_PHONE_DIGITS + 1);

    expect(participantSchema.safeParse(pessoa({ whatsapp: noLimite })).success).toBe(true);
    expect(participantSchema.safeParse(pessoa({ whatsapp: acima })).success).toBe(false);
    // E o que a máscara deixa digitar nunca é o que o schema recusa.
    expect(participantSchema.safeParse(pessoa({ whatsapp: formatPhoneInput(acima) })).success).toBe(
      true,
    );
  });

  it("abaixo do mínimo continua sendo recusado pelo schema, e a máscara não opina", () => {
    const curto = "1".repeat(MIN_PHONE_DIGITS - 1);
    expect(formatPhoneInput(curto)).toContain("(");
    expect(participantSchema.safeParse(pessoa({ whatsapp: curto })).success).toBe(false);
  });
});
