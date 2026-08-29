import { describe, expect, it } from "vitest";
import {
  newPasswordSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  resetRequestSchema,
} from "./password";
import { sanitizeRememberedEmail } from "./remember";
import { AUTH_ERROR_MESSAGES, AUTH_RESET_SENT_MESSAGE } from "./types";

describe("newPasswordSchema", () => {
  it("aceita uma senha do tamanho mínimo com a confirmação igual", () => {
    const senha = "a".repeat(PASSWORD_MIN_LENGTH);
    expect(newPasswordSchema.safeParse({ password: senha, confirmation: senha }).success).toBe(
      true,
    );
  });

  /**
   * ⚠️ ESTE TESTE PRENDE O PISO NO CÓDIGO. O padrão do Supabase é 6, e sem esta
   * asserção nada impediria alguém de "simplificar" removendo o `.min()` — a
   * regra passaria a morar numa configuração de painel que ninguém deste lado
   * revisa, e o sistema aceitaria senha de seis caracteres sem um único aviso.
   */
  it("recusa senha mais curta que o piso", () => {
    const curta = "a".repeat(PASSWORD_MIN_LENGTH - 1);
    expect(newPasswordSchema.safeParse({ password: curta, confirmation: curta }).success).toBe(
      false,
    );
  });

  /**
   * ⚠️ O TETO É DO BCRYPT, não uma preferência. Ele ignora silenciosamente o que
   * passa de 72 bytes: sem este limite, quem escolhesse uma frase de 100
   * caracteres autenticaria com os 72 primeiros e nunca saberia que o resto não
   * conta. Recusar é honesto; truncar em silêncio não.
   */
  it("recusa senha maior que o teto do bcrypt", () => {
    const longa = "a".repeat(PASSWORD_MAX_LENGTH + 1);
    expect(newPasswordSchema.safeParse({ password: longa, confirmation: longa }).success).toBe(
      false,
    );
  });

  it("acusa a confirmação quando as duas não batem", () => {
    const r = newPasswordSchema.safeParse({ password: "senha-boa-1", confirmation: "senha-boa-2" });
    expect(r.success).toBe(false);
    // O caminho do erro é o que a action usa para escolher entre "senha curta" e
    // "as senhas não conferem". Se ele mudar, a mensagem errada aparece na tela.
    if (!r.success) expect(r.error.issues[0]?.path[0]).toBe("confirmation");
  });
});

describe("resetRequestSchema", () => {
  it("normaliza o e-mail para minúsculas e sem espaços", () => {
    const r = resetRequestSchema.safeParse({ email: "  Maria@APCS.org.br " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("maria@apcs.org.br");
  });

  it("recusa o que não é e-mail", () => {
    expect(resetRequestSchema.safeParse({ email: "sem-arroba" }).success).toBe(false);
    expect(resetRequestSchema.safeParse({ email: "" }).success).toBe(false);
  });
});

describe("sanitizeRememberedEmail", () => {
  it("guarda o e-mail em minúsculas", () => {
    expect(sanitizeRememberedEmail(" Maria@APCS.org.br ")).toBe("maria@apcs.org.br");
  });

  it("recusa o que não parece e-mail", () => {
    expect(sanitizeRememberedEmail("")).toBeNull();
    expect(sanitizeRememberedEmail("   ")).toBeNull();
    expect(sanitizeRememberedEmail("sem-arroba")).toBeNull();
    expect(sanitizeRememberedEmail(undefined)).toBeNull();
    expect(sanitizeRememberedEmail(42)).toBeNull();
  });

  /**
   * ⚠️ O TETO DE TAMANHO PROTEGE TODAS AS REQUISIÇÕES, não só o login. O cookie
   * volta ao servidor em cada uma delas — inclusive nas do webhook do WhatsApp e
   * nas do cron. Um POST fabricado com um "e-mail" de dez mil caracteres viraria
   * peso em todas.
   */
  it("recusa valor absurdamente longo", () => {
    expect(sanitizeRememberedEmail(`${"a".repeat(300)}@apcs.org.br`)).toBeNull();
  });

  /**
   * ⚠️ QUEBRA DE LINHA EM COOKIE É INJEÇÃO DE CABEÇALHO. O regex de formato já
   * barraria (`\s`), mas o caso fica escrito: se alguém trocar a validação de
   * formato por uma mais frouxa, este teste é quem acusa.
   */
  it("recusa quebra de linha e ponto e vírgula", () => {
    expect(sanitizeRememberedEmail("a@b.co\nSet-Cookie: x=1")).toBeNull();
    expect(sanitizeRememberedEmail("a@b.co; admin=1")).toBeNull();
  });
});

describe("as mensagens de autenticação", () => {
  /**
   * ⚠️ A CONFIRMAÇÃO NÃO PODE AFIRMAR QUE A CONTA EXISTE. Uma frase como
   * "enviamos para o seu e-mail" transforma a tela num verificador de cadastro:
   * quem quiser a lista de quem trabalha na APCS testa endereços um a um. Ver o
   * cabeçalho de `requestPasswordResetAction`.
   */
  it("a confirmação do envio é condicional", () => {
    expect(AUTH_RESET_SENT_MESSAGE).toMatch(/^Se houver/);
    expect(AUTH_RESET_SENT_MESSAGE).toMatch(/spam/i);
  });

  it("o link inválido diz o que fazer, e não só o que houve", () => {
    expect(AUTH_ERROR_MESSAGES.recoveryLinkInvalid).toMatch(/novo/i);
  });

  it("o excesso de tentativas dá um prazo, e não um 'tente mais tarde'", () => {
    expect(AUTH_ERROR_MESSAGES.tooManyRequests).toMatch(/minuto/i);
  });
});
