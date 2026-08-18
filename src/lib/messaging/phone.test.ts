import { describe, expect, it } from "vitest";
import { maskPhone, PHONE_REJECTION_REASONS, sameWhatsAppNumber, toWhatsAppNumber } from "./phone";

/**
 * §30. O TELEFONE.
 *
 * ⚠️ O caso que justifica o arquivo inteiro é o fixo: `(14) 3622-8140` está na
 * base REAL deste projeto. É um telefone perfeitamente válido que simplesmente
 * não tem WhatsApp — e mandado ao fornecedor ele não dá erro na hora, dá "não
 * entregue" horas depois, quando ninguém está olhando.
 */

describe("toWhatsAppNumber — celular", () => {
  it("aceita o formato que o cadastro deste projeto usa", () => {
    const r = toWhatsAppNumber("(19) 99123-4567");
    expect(r.ok && r.e164).toBe("5519991234567");
  });

  it("aceita só dígitos", () => {
    const r = toWhatsAppNumber("19991234567");
    expect(r.ok && r.e164).toBe("5519991234567");
  });

  it("aceita com código do país, com e sem +", () => {
    expect(toWhatsAppNumber("+55 19 99123-4567")).toMatchObject({ e164: "5519991234567" });
    expect(toWhatsAppNumber("5519991234567")).toMatchObject({ e164: "5519991234567" });
  });

  it("⚠️ 55 como DDD não é confundido com o código do país", () => {
    // 55 é o DDD de Caxias do Sul. A decisão é pelo COMPRIMENTO, não pelo
    // prefixo: `(55) 99123-4567` tem 11 dígitos e é nacional.
    const r = toWhatsAppNumber("(55) 99123-4567");
    expect(r.ok && r.e164).toBe("5555991234567");
    expect(r.ok && r.ddd).toBe(55);
  });
});

describe("toWhatsAppNumber — o que é recusado, e por quê", () => {
  it("⚠️ FIXO é recusado — o caso real da base", () => {
    const r = toWhatsAppNumber("(14) 3622-8140");
    expect(r).toEqual({ ok: false, reason: "landline" });
    // A frase tem de dizer o que fazer, não o que falhou.
    expect(PHONE_REJECTION_REASONS.landline).toMatch(/cadastre um celular/i);
  });

  it("vazio e nulo viram 'empty', não erro", () => {
    expect(toWhatsAppNumber("")).toEqual({ ok: false, reason: "empty" });
    expect(toWhatsAppNumber(null)).toEqual({ ok: false, reason: "empty" });
    expect(toWhatsAppNumber(undefined)).toEqual({ ok: false, reason: "empty" });
    expect(toWhatsAppNumber("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("curto e longo demais", () => {
    expect(toWhatsAppNumber("991234567")).toEqual({ ok: false, reason: "too_short" });
    expect(toWhatsAppNumber("199912345678")).toEqual({ ok: false, reason: "too_long" });
  });

  it("⚠️ DDD que não existe é recusado antes de gastar uma chamada", () => {
    // 23, 25 e 10 não são DDD nenhum. Sem a lista, `\\d{2}` os aceitaria e o
    // fornecedor recusaria depois — cobrando a tentativa.
    expect(toWhatsAppNumber("(23) 99123-4567")).toEqual({ ok: false, reason: "unknown_area" });
    expect(toWhatsAppNumber("(10) 99123-4567")).toEqual({ ok: false, reason: "unknown_area" });
    expect(toWhatsAppNumber("(00) 99123-4567")).toEqual({ ok: false, reason: "unknown_area" });
  });

  it("celular sem o nono dígito não passa por celular", () => {
    // 11 dígitos mas começando em 8: não é o padrão de celular brasileiro.
    expect(toWhatsAppNumber("19881234567")).toEqual({ ok: false, reason: "malformed" });
  });

  it("letras e lixo não viram número", () => {
    expect(toWhatsAppNumber("telefone")).toEqual({ ok: false, reason: "empty" });
    // ⚠️ Repare no `alert(1)`: sobra o dígito 1. O resultado certo é
    // "too_short", e não "empty" — o que importa é que NADA disso vira um
    // número enviável.
    expect(toWhatsAppNumber("<script>alert(1)</script>")).toMatchObject({ ok: false });
    expect(toWhatsAppNumber("'; drop table surveys; --")).toMatchObject({ ok: false });
  });

  it("toda recusa tem uma frase escrita", () => {
    for (const chave of Object.keys(PHONE_REJECTION_REASONS)) {
      expect(
        PHONE_REJECTION_REASONS[chave as keyof typeof PHONE_REJECTION_REASONS].length,
      ).toBeGreaterThan(10);
    }
  });
});

describe("sameWhatsAppNumber — o caminho de volta", () => {
  it("⚠️ o que o fornecedor manda casa com o que o cadastro guarda", () => {
    // Esta é a comparação que o webhook faz. Comparando as strings cruas
    // ("5519991234567" vs "(19) 99123-4567") ela falharia em TODO contato
    // formatado — que neste banco são todos —, e nenhuma resposta seria
    // registrada, sem erro nenhum aparecendo.
    expect(sameWhatsAppNumber("5519991234567", "(19) 99123-4567")).toBe(true);
  });

  it("números diferentes não casam", () => {
    expect(sameWhatsAppNumber("5519991234567", "(19) 99123-4568")).toBe(false);
    expect(sameWhatsAppNumber("5519991234567", "(11) 99123-4567")).toBe(false);
  });

  it("um fixo nunca casa, nem com ele mesmo", () => {
    // Coerência: se não dá para mandar, também não dá para reconhecer como
    // origem de uma mensagem de WhatsApp.
    expect(sameWhatsAppNumber("(14) 3622-8140", "(14) 3622-8140")).toBe(false);
  });

  it("nulos não casam", () => {
    expect(sameWhatsAppNumber(null, "5519991234567")).toBe(false);
    expect(sameWhatsAppNumber("5519991234567", null)).toBe(false);
  });
});

describe("maskPhone (§50, §54)", () => {
  it("mostra só os quatro últimos dígitos", () => {
    // O log precisa de identificação suficiente para casar uma linha com um
    // relato, e não precisa do número inteiro.
    expect(maskPhone("(19) 99123-4567")).toBe("***4567");
    expect(maskPhone("5519991234567")).toBe("***4567");
  });

  it("nunca devolve o número inteiro", () => {
    expect(maskPhone("5519991234567")).not.toContain("9912");
    expect(maskPhone("123")).toBe("***");
    expect(maskPhone(null)).toBe("***");
  });
});
