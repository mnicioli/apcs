import { describe, expect, it } from "vitest";
import { envOrFallback } from "@/lib/chat/env";

describe("envOrFallback", () => {
  it("usa o valor quando ele existe", () => {
    expect(envOrFallback("https://apcs.org.br/privacidade", "(padrão)")).toBe(
      "https://apcs.org.br/privacidade",
    );
  });

  it("cai no padrão quando a variável não foi declarada", () => {
    expect(envOrFallback(undefined, "(padrão)")).toBe("(padrão)");
  });

  // O caso que motivou o helper: `.env.example` copiado sem preencher deixa
  // `APCS_PRIVACY_POLICY_URL=`, e o `??` original deixava a string vazia passar
  // direto para o texto do consentimento ("...política de privacidade em .").
  it("cai no padrão quando a variável foi declarada vazia", () => {
    expect(envOrFallback("", "(padrão)")).toBe("(padrão)");
  });

  it("cai no padrão quando a variável só tem espaço em branco", () => {
    expect(envOrFallback("   ", "(padrão)")).toBe("(padrão)");
  });

  it("remove espaço em volta do valor", () => {
    expect(envOrFallback("  claude-opus-5  ", "(padrão)")).toBe("claude-opus-5");
  });
});
