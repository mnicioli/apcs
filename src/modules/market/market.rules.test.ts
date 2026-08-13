import { describe, expect, it } from "vitest";
import {
  activeVersion,
  buildVersionName,
  canDeactivateVersion,
  compareBulletins,
  compareVersionsDesc,
  isAvailableForChatbot,
  isEffective,
  matchesBulletinFilters,
  matchesVersionFilters,
  nextVersionNumber,
  versionSituation,
} from "./market.rules";
import type { MarketBulletinVersion, MarketFilters } from "./market.types";

const HOJE = "2026-08-12";

function versao(overrides: Partial<MarketBulletinVersion> = {}): MarketBulletinVersion {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    bulletinId: "22222222-2222-2222-2222-222222222222",
    version: 1,
    versionName: "Bolsa_12Ago26",
    status: "active",
    statusReason: null,
    effectiveDate: HOJE,
    image: { originalFilename: "bolsa.jpg", mimeType: "image/jpeg", sizeBytes: 1024 },
    pdf: { originalFilename: "bolsa.pdf", mimeType: "application/pdf", sizeBytes: 2048 },
    uploadedBy: null,
    uploadedAt: "2026-08-12T12:00:00Z",
    activatedAt: "2026-08-12T12:00:00Z",
    deactivatedAt: null,
    ...overrides,
  };
}

const SEM_FILTRO: MarketFilters = { query: "", status: "all", from: "", to: "" };

function filtros(overrides: Partial<MarketFilters> = {}): MarketFilters {
  return { ...SEM_FILTRO, ...overrides };
}

describe("buildVersionName — a identidade funcional da publicação", () => {
  it("monta o nome no formato da APCS", () => {
    expect(buildVersionName("2026-08-12")).toBe("Bolsa_12Ago26");
    expect(buildVersionName("2026-07-01")).toBe("Bolsa_01Jul26");
    expect(buildVersionName("2026-12-31")).toBe("Bolsa_31Dez26");
  });

  it("cobre os doze meses em português", () => {
    const nomes = Array.from({ length: 12 }, (_, i) =>
      buildVersionName(`2026-${String(i + 1).padStart(2, "0")}-01`),
    );

    expect(nomes).toEqual([
      "Bolsa_01Jan26",
      "Bolsa_01Fev26",
      "Bolsa_01Mar26",
      "Bolsa_01Abr26",
      "Bolsa_01Mai26",
      "Bolsa_01Jun26",
      "Bolsa_01Jul26",
      "Bolsa_01Ago26",
      "Bolsa_01Set26",
      "Bolsa_01Out26",
      "Bolsa_01Nov26",
      "Bolsa_01Dez26",
    ]);
  });

  /**
   * A regressão que este teste trava: `new Date("2026-08-12")` é meia-noite UTC,
   * que em São Paulo é 21h do dia 11 — a publicação do dia 12 viraria
   * "Bolsa_11Ago26". O recorte de string não tem fuso, então não tem como errar.
   */
  it("não desloca o dia por causa de fuso", () => {
    expect(buildVersionName("2026-01-01")).toBe("Bolsa_01Jan26");
    expect(buildVersionName("2026-03-01")).toBe("Bolsa_01Mar26");
  });

  it("recusa o que não é uma data AAAA-MM-DD", () => {
    expect(buildVersionName("12/08/2026")).toBeNull();
    expect(buildVersionName("2026-13-01")).toBeNull();
    expect(buildVersionName("")).toBeNull();
  });

  /**
   * O banco impõe o formato num CHECK. Se as duas pontas discordarem, a
   * publicação é recusada na hora de gravar — este teste faz isso aparecer aqui.
   */
  it("produz um nome que o CHECK do banco aceita", () => {
    const formatoDoBanco =
      /^Bolsa_[0-3][0-9](Jan|Fev|Mar|Abr|Mai|Jun|Jul|Ago|Set|Out|Nov|Dez)[0-9]{2}(-[1-9][0-9]*)?$/;

    for (let mes = 1; mes <= 12; mes += 1) {
      const nome = buildVersionName(`2027-${String(mes).padStart(2, "0")}-28`);
      expect(nome).not.toBeNull();
      expect(nome!).toMatch(formatoDoBanco);
    }
  });
});

describe("nextVersionNumber", () => {
  it("a primeira publicação é a 1", () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  it("é o maior + 1, nunca a quantidade + 1", () => {
    expect(nextVersionNumber([{ version: 1 }, { version: 2 }, { version: 3 }])).toBe(4);
  });

  /**
   * Reativar a v1 não devolve o número 2 ao estoque: a numeração é a memória do
   * histórico, e o histórico não encolhe.
   */
  it("não reutiliza número depois de reativar uma publicação antiga", () => {
    expect(nextVersionNumber([{ version: 1 }, { version: 3 }])).toBe(4);
  });
});

describe("vigência — ATIVA ≠ VIGENTE", () => {
  it("vigência de hoje já vale", () => {
    expect(isEffective(versao({ effectiveDate: HOJE }), HOJE)).toBe(true);
  });

  it("vigência passada vale", () => {
    expect(isEffective(versao({ effectiveDate: "2026-07-01" }), HOJE)).toBe(true);
  });

  it("vigência futura ainda não vale", () => {
    expect(isEffective(versao({ effectiveDate: "2026-08-15" }), HOJE)).toBe(false);
  });

  it("ativa e vigente é a publicação que vale agora", () => {
    expect(versionSituation(versao({ effectiveDate: HOJE }), HOJE)).toBe("current");
  });

  it("ativa com vigência futura está PROGRAMADA, não vigente", () => {
    expect(versionSituation(versao({ effectiveDate: "2026-08-15" }), HOJE)).toBe("scheduled");
  });

  it("inativa é histórica, mesmo com vigência já corrida", () => {
    const antiga = versao({ status: "inactive", effectiveDate: "2026-07-01" });
    expect(versionSituation(antiga, HOJE)).toBe("historical");
  });
});

describe("activeVersion", () => {
  it("acha a ativa no meio do histórico", () => {
    const versoes = [
      versao({ id: "a", version: 3, status: "inactive", statusReason: "superseded" }),
      versao({ id: "b", version: 2, status: "active" }),
      versao({ id: "c", version: 1, status: "inactive", statusReason: "superseded" }),
    ];

    expect(activeVersion(versoes)?.id).toBe("b");
  });

  it("devolve null quando ainda não houve publicação", () => {
    expect(activeVersion([])).toBeNull();
  });
});

describe("canDeactivateVersion — a Bolsa nunca fica sem publicação ativa", () => {
  it("a publicação ATIVA não pode ser inativada", () => {
    expect(canDeactivateVersion(versao({ status: "active" }))).toBe(false);
  });

  it("uma publicação já inativa não tem o que inativar", () => {
    expect(canDeactivateVersion(versao({ status: "inactive" }))).toBe(true);
  });
});

describe("isAvailableForChatbot — as três condições, e nenhuma a menos", () => {
  const ligada = { chatbotEnabled: true };

  it("ativa + vigente + Bolsa ligada = disponível", () => {
    expect(isAvailableForChatbot(ligada, versao({ effectiveDate: HOJE }), HOJE)).toBe(true);
  });

  it("vigência amanhã = INDISPONÍVEL, mesmo estando ativa", () => {
    expect(isAvailableForChatbot(ligada, versao({ effectiveDate: "2026-08-13" }), HOJE)).toBe(
      false,
    );
  });

  it("Bolsa desligada = indisponível, mesmo com publicação vigente", () => {
    expect(isAvailableForChatbot({ chatbotEnabled: false }, versao(), HOJE)).toBe(false);
  });

  it("publicação inativa = indisponível", () => {
    const inativa = versao({ status: "inactive", statusReason: "superseded" });
    expect(isAvailableForChatbot(ligada, inativa, HOJE)).toBe(false);
  });

  /**
   * A regra que evita o pior erro possível deste módulo: apresentar um boletim
   * de PREÇO que não é o oficial. Sem publicação disponível, a resposta é
   * "indisponível" — nunca a versão anterior.
   */
  it("sem publicação nenhuma = indisponível, e não a anterior", () => {
    expect(isAvailableForChatbot(ligada, null, HOJE)).toBe(false);
  });
});

describe("matchesVersionFilters", () => {
  it("sem filtro, passa tudo", () => {
    expect(matchesVersionFilters(versao(), SEM_FILTRO)).toBe(true);
  });

  it("filtra por status", () => {
    expect(
      matchesVersionFilters(versao({ status: "active" }), filtros({ status: "inactive" })),
    ).toBe(false);
    expect(matchesVersionFilters(versao({ status: "active" }), filtros({ status: "active" }))).toBe(
      true,
    );
  });

  it("recorta por faixa de vigência, inclusiva nas duas pontas", () => {
    const v = versao({ effectiveDate: "2026-08-12" });

    expect(matchesVersionFilters(v, filtros({ from: "2026-08-12" }))).toBe(true);
    expect(matchesVersionFilters(v, filtros({ to: "2026-08-12" }))).toBe(true);
    expect(matchesVersionFilters(v, filtros({ from: "2026-08-13" }))).toBe(false);
    expect(matchesVersionFilters(v, filtros({ to: "2026-08-11" }))).toBe(false);
  });

  it("busca pelo nome da publicação, ignorando caixa", () => {
    const v = versao({ versionName: "Bolsa_12Ago26" });

    expect(matchesVersionFilters(v, filtros({ query: "12ago" }))).toBe(true);
    expect(matchesVersionFilters(v, filtros({ query: "01Jul" }))).toBe(false);
  });
});

describe("matchesBulletinFilters", () => {
  it("acha 'Suínos' mesmo digitado sem acento", () => {
    expect(matchesBulletinFilters({ name: "Bolsa de Suínos" }, { query: "suinos" })).toBe(true);
  });

  it("query vazia passa tudo", () => {
    expect(matchesBulletinFilters({ name: "Bolsa de Suínos" }, { query: "" })).toBe(true);
  });
});

describe("ordenação", () => {
  it("o histórico vem da publicação mais nova para a mais antiga", () => {
    const ordenado = [{ version: 1 }, { version: 3 }, { version: 2 }].sort(compareVersionsDesc);
    expect(ordenado.map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it("as bolsas saem em ordem alfabética do português", () => {
    const ordenado = [{ name: "Bolsa de Suínos" }, { name: "Bolsa de Aves" }].sort(
      compareBulletins,
    );
    expect(ordenado.map((b) => b.name)).toEqual(["Bolsa de Aves", "Bolsa de Suínos"]);
  });
});
