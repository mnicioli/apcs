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
