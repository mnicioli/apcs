import { describe, expect, it } from "vitest";
import {
  compareDocuments,
  compareVersionsDesc,
  currentVersion,
  documentStatus,
  formatCalendarDate,
  formatFileSize,
  matchesDocumentFilters,
  nextVersionNumber,
  normalizeForSearch,
  versionLabel,
} from "./document.rules";
import type { DocumentSummary, DocumentVersion, DocumentVersionStatus } from "./document.types";

function versao(version: number, status: DocumentVersionStatus = "inactive"): DocumentVersion {
  return {
    id: `v${version}`,
    documentId: "doc-1",
    version,
    status,
    availableForChatbot: status === "active",
    originalFilename: "normativa.pdf",
    fileSizeBytes: 1024,
    effectiveDate: "2026-08-15",
    uploadedBy: null,
    uploadedAt: "2026-08-01T12:00:00Z",
    activatedAt: null,
    deactivatedAt: null,
  };
}

function normativa(patch: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id: "doc-1",
    category: "normative",
    name: "Selo Suíno Paulista",
    description: null,
    status: "active",
    currentVersion: null,
    versionCount: 0,
    updatedAt: "2026-08-01T12:00:00Z",
    ...patch,
  };
}

describe("nextVersionNumber", () => {
  it("começa em v1", () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  it("segue a sequência", () => {
    expect(nextVersionNumber([versao(1), versao(2), versao(3)])).toBe(4);
  });

  // O caso do item 18: reativar não devolve um número ao estoque. Se a conta
  // fosse "quantidade + 1" ou "última ativa + 1", este teste pegaria.
  it("não reutiliza número depois de reativar uma versão antiga", () => {
    const historico = [versao(1, "active"), versao(2), versao(3)];
    expect(nextVersionNumber(historico)).toBe(4);
  });

  it("não se perde com o histórico fora de ordem", () => {
    expect(nextVersionNumber([versao(3), versao(1), versao(2)])).toBe(4);
  });
});

describe("versionLabel", () => {
  it("identifica a versão por normativa + número, não pelo nome do arquivo", () => {
    expect(versionLabel(3)).toBe("v3");
    expect(versionLabel(12)).toBe("v12");
  });
});

describe("currentVersion", () => {
  it("mostra a ativa, mesmo não sendo a de maior número", () => {
    const escolhida = currentVersion([versao(1, "active"), versao(2), versao(3)]);
    expect(escolhida?.version).toBe(1);
  });

  // Estado válido (RN25): a normativa pode ficar sem versão ativa. A linha da
  // grid ainda precisa dizer alguma coisa.
  it("cai na mais recente quando nenhuma está ativa", () => {
    const escolhida = currentVersion([versao(1), versao(3), versao(2)]);
    expect(escolhida?.version).toBe(3);
  });

  it("devolve null quando a normativa nunca recebeu arquivo", () => {
    expect(currentVersion([])).toBeNull();
  });
});

describe("documentStatus", () => {
  it("é ativo só quando existe versão ativa", () => {
    expect(documentStatus([versao(1), versao(2, "active")])).toBe("active");
  });

  it("normativa com todas as versões inativas é inativa", () => {
    expect(documentStatus([versao(1), versao(2)])).toBe("inactive");
  });

  it("normativa sem nenhuma versão é inativa", () => {
    expect(documentStatus([])).toBe("inactive");
  });
});

describe("compareVersionsDesc", () => {
  it("ordena o histórico da mais nova para a mais antiga", () => {
    const ordenado = [versao(1), versao(3), versao(2)]
      .sort(compareVersionsDesc)
      .map((v) => v.version);
    expect(ordenado).toEqual([3, 2, 1]);
  });
});

describe("normalizeForSearch", () => {
  // Ninguém digita acento numa caixa de busca.
  it("ignora acento e caixa", () => {
    expect(normalizeForSearch("  CÂMARA Ambiental ")).toBe("camara ambiental");
  });

  it("mantém o ç legível", () => {
    expect(normalizeForSearch("Produção")).toBe("producao");
  });
});

describe("matchesDocumentFilters", () => {
  const ambiental = normativa({ id: "a", name: "Câmara Ambiental", status: "active" });
  const setorial = normativa({ id: "s", name: "Câmara Setorial", status: "inactive" });
  const selo = normativa({ id: "p", name: "Selo Suíno Paulista", status: "active" });

  it("busca parcial pega as duas Câmaras e deixa o Selo de fora", () => {
    const achados = [ambiental, setorial, selo]
      .filter((d) => matchesDocumentFilters(d, { query: "Câmara", status: "all" }))
      .map((d) => d.name);

    expect(achados).toEqual(["Câmara Ambiental", "Câmara Setorial"]);
  });

  it("acha o mesmo resultado sem o acento", () => {
    expect(matchesDocumentFilters(ambiental, { query: "camara", status: "all" })).toBe(true);
  });

  it("combina nome e status", () => {
    expect(matchesDocumentFilters(setorial, { query: "Câmara", status: "active" })).toBe(false);
    expect(matchesDocumentFilters(ambiental, { query: "Câmara", status: "active" })).toBe(true);
  });

  it("filtro vazio não esconde nada", () => {
    expect(matchesDocumentFilters(selo, { query: "   ", status: "all" })).toBe(true);
  });
});

describe("compareDocuments", () => {
  it("ordena pelo alfabeto do português", () => {
    const ordenado = [
      normativa({ name: "Selo Suíno Paulista" }),
      normativa({ name: "Área de Manejo" }),
      normativa({ name: "Câmara Ambiental" }),
    ]
      .sort(compareDocuments)
      .map((d) => d.name);

    expect(ordenado).toEqual(["Área de Manejo", "Câmara Ambiental", "Selo Suíno Paulista"]);
  });
});

describe("formatCalendarDate", () => {
  // O bug que esta função existe para evitar: `new Date("2026-08-15")` é
  // meia-noite UTC, que em São Paulo é 21h de 14/08. A tela mostraria a
  // vigência um dia antes do que está escrito no documento.
  it("não desloca o dia por causa de fuso", () => {
    expect(formatCalendarDate("2026-08-15")).toBe("15/08/2026");
    expect(formatCalendarDate("2026-01-01")).toBe("01/01/2026");
  });

  it("devolve travessão para valor que não é data", () => {
    expect(formatCalendarDate("15/08/2026")).toBe("—");
    expect(formatCalendarDate("")).toBe("—");
  });
});

describe("formatFileSize", () => {
  it("usa a unidade que a pessoa consegue ler", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
  });

  // Uma casa decimal perto do teto: "5 MB" para 4,9 e para 5,4 não explicaria
  // por que um passou e o outro foi recusado.
  it("mostra a casa decimal perto do limite de 5 MB", () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5,0 MB");
    expect(formatFileSize(Math.round(4.9 * 1024 * 1024))).toBe("4,9 MB");
  });

  it("não inventa tamanho para valor inválido", () => {
    expect(formatFileSize(Number.NaN)).toBe("—");
    expect(formatFileSize(-1)).toBe("—");
  });
});
