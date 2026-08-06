import { describe, expect, it } from "vitest";
import { getInitials, toSessionUser } from "./session";

describe("getInitials", () => {
  it("retorna as duas primeiras iniciais em maiúsculas", () => {
    expect(getInitials("Ana Lima")).toBe("AL");
  });

  it("lida com nome único", () => {
    expect(getInitials("Ana")).toBe("A");
  });

  it("retorna '?' para string vazia", () => {
    expect(getInitials("")).toBe("?");
  });
});

describe("toSessionUser", () => {
  it("usa full_name do metadata quando presente", () => {
    const user = toSessionUser({
      id: "1",
      email: "ana@empresa.com",
      user_metadata: { full_name: "Ana Lima" },
    });
    expect(user.fullName).toBe("Ana Lima");
  });

  it("cai no e-mail quando não há full_name", () => {
    const user = toSessionUser({ id: "1", email: "ana@empresa.com" });
    expect(user.fullName).toBe("ana@empresa.com");
  });

  // O perfil ganha do metadata: é em `profiles` que /profile grava. Invertido,
  // editar o nome no app não teria efeito nenhum no cabeçalho.
  it("prefere o nome do perfil ao do metadata", () => {
    const user = toSessionUser(
      { id: "1", email: "ana@empresa.com", user_metadata: { full_name: "Nome Antigo" } },
      { full_name: "Ana Lima" },
    );
    expect(user.fullName).toBe("Ana Lima");
  });

  it("usa o nome do perfil quando o metadata está vazio", () => {
    const user = toSessionUser({ id: "1", email: "ana@empresa.com" }, { full_name: "Ana Lima" });
    expect(user.fullName).toBe("Ana Lima");
  });

  it("ignora nome de perfil em branco e cai no metadata", () => {
    const user = toSessionUser(
      { id: "1", email: "ana@empresa.com", user_metadata: { full_name: "Ana Lima" } },
      { full_name: "   " },
    );
    expect(user.fullName).toBe("Ana Lima");
  });

  it("cai no e-mail quando perfil e metadata estão vazios", () => {
    const user = toSessionUser({ id: "1", email: "ana@empresa.com" }, { full_name: null });
    expect(user.fullName).toBe("ana@empresa.com");
  });

  // A allowlist de host vale para o avatar venha ele de onde vier.
  it("rejeita avatar de host não permitido vindo do perfil", () => {
    const user = toSessionUser(
      { id: "1", email: "ana@empresa.com" },
      { avatar_url: "https://evil.example.com/pixel.png" },
    );
    expect(user.avatarUrl).toBeNull();
  });

  it("rejeita avatar de host não permitido (anti-tracking)", () => {
    const user = toSessionUser({
      id: "1",
      email: "ana@empresa.com",
      user_metadata: { avatar_url: "https://evil.example.com/pixel.png" },
    });
    expect(user.avatarUrl).toBeNull();
  });

  it("aceita avatar de host permitido", () => {
    const url = "https://abc.supabase.co/storage/avatar.png";
    const user = toSessionUser({
      id: "1",
      email: "ana@empresa.com",
      user_metadata: { avatar_url: url },
    });
    expect(user.avatarUrl).toBe(url);
  });
});
