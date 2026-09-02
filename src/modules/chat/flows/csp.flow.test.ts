import { describe, expect, it } from "vitest";
import {
  applyCspDefaults,
  buildCspSummary,
  isCspTriageComplete,
  mergeCollected,
  nextCspSlot,
} from "./csp.flow";
import type { CspCollected } from "../chat.types";

describe("ordem da triagem", () => {
  it("começa pelo nome", () => {
    expect(nextCspSlot({})?.key).toBe("fullName");
  });

  it("só pede o contato depois de saber o canal", () => {
    const withoutChannel: CspCollected = {
      fullName: "João",
      city: "Piracicaba",
      state: "SP",
      contactProfile: "producer",
      interest: "feed",
      volumeRange: "up_to_50",
    };
    expect(nextCspSlot(withoutChannel)?.key).toBe("contactChannel");

    const withChannel = { ...withoutChannel, preferredChannel: "whatsapp" as const };
    expect(nextCspSlot(withChannel)?.key).toBe("contactValue");
  });

  it("aceita e-mail como dado de contato quando o canal é e-mail", () => {
    const collected: CspCollected = {
      fullName: "Ana",
      city: "Campinas",
      state: "SP",
      contactProfile: "member",
      interest: "input",
      volumeRange: "up_to_50",
      preferredChannel: "email",
      email: "ana@exemplo.com",
    };
    // Horário não se aplica a e-mail — a triagem fecha aqui.
    expect(isCspTriageComplete(collected)).toBe(true);
  });

  it("fecha a triagem quando todos os campos exigidos estão preenchidos", () => {
    const collected: CspCollected = {
      fullName: "João",
      city: "Piracicaba",
      state: "SP",
      contactProfile: "producer",
      interest: "feed",
      volumeRange: "above_1000",
      preferredChannel: "phone",
      phone: "1999998888",
      preferredTime: "afternoon",
    };
    expect(isCspTriageComplete(collected)).toBe(true);
    expect(nextCspSlot(collected)).toBeNull();
  });
});

describe("applyCspDefaults", () => {
  it("marca porte como não aplicável para fornecedor", () => {
    expect(applyCspDefaults({ contactProfile: "supplier" }).volumeRange).toBe("not_applicable");
  });

  it("não sobrescreve porte já informado", () => {
    const collected: CspCollected = { contactProfile: "supplier", volumeRange: "up_to_50" };
    expect(applyCspDefaults(collected).volumeRange).toBe("up_to_50");
  });

  it("não mexe em produtor", () => {
    expect(applyCspDefaults({ contactProfile: "producer" }).volumeRange).toBeUndefined();
  });
});

describe("mergeCollected", () => {
  it("preserva o que já existia e acrescenta o novo", () => {
    const merged = mergeCollected({ fullName: "João" }, { city: "Piracicaba" });
    expect(merged).toEqual({ fullName: "João", city: "Piracicaba" });
  });

  it("ignora valores vazios vindos do LLM", () => {
    const merged = mergeCollected({ fullName: "João" }, { fullName: "", city: "Piracicaba" });
    expect(merged.fullName).toBe("João");
  });

  it("deixa o dado mais recente vencer quando a pessoa se corrige", () => {
    const merged = mergeCollected({ city: "Piracicaba" }, { city: "Campinas" });
    expect(merged.city).toBe("Campinas");
  });
});

describe("buildCspSummary", () => {
  it("mostra só o que foi informado, com rótulos em PT-BR", () => {
    const summary = buildCspSummary({
      fullName: "João da Silva",
      city: "Piracicaba",
      state: "SP",
      contactProfile: "producer",
      interest: "feed",
      preferredChannel: "whatsapp",
      phone: "19999991234",
    });

    expect(summary).toContain("Nome: João da Silva");
    expect(summary).toContain("Cidade: Piracicaba/SP");
    expect(summary).toContain("Perfil: Produtor");
    expect(summary).toContain("Interesse: Ração");
    expect(summary).toContain("Contato: WhatsApp — 19999991234");
    expect(summary).not.toContain("Porte");
  });
});
