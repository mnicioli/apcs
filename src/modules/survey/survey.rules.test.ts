import { describe, expect, it } from "vitest";
import {
  canActivate,
  canCancel,
  canClose,
  canDelete,
  canEditAudience,
  canEditDetails,
  canEditStructure,
  isAcceptingResponses,
  isAudienceDimensionAvailable,
  isDispatchAfterStart,
  isWindowValid,
  optionPercentage,
  participationRate,
  resolveOptionByPosition,
  responseMessage,
  surveyStage,
} from "./survey.rules";
import {
  SURVEY_RESPONSE_ALREADY,
  SURVEY_RESPONSE_CLOSED,
  SURVEY_RESPONSE_INVALID,
  SURVEY_RESPONSE_THANKS,
  SURVEY_RESPONSE_UNAVAILABLE,
} from "./survey.labels";
import type { Survey, SurveyOption, SurveyStatus } from "./survey.types";

/**
 * Testes das regras puras de Enquetes.
 *
 * ⚠️ O que estes testes NÃO provam: que uma resposta entra ou não entra. Quem
 * decide isso é `survey_response_gate()`, no banco, e quem prova é a bateria SQL
 * rodada contra o banco real. O que se prova aqui é a LEITURA da mesma regra —
 * o que a tela mostra. As duas precisam concordar, e a bateria confere.
 */

const AGORA = new Date("2026-08-14T12:00:00Z");

function enquete(overrides: Partial<Survey> = {}): Survey {
  return {
    id: "s-1",
    title: "Expectativa do valor da arroba",
    description: null,
    status: "active",
    startsAt: "2026-08-14T08:00:00Z",
    endsAt: "2026-08-20T23:59:00Z",
    scheduledAt: "2026-08-14T09:00:00Z",
    isAnonymous: false,
    allowsResponseChange: false,
    singleResponseOnly: true,
    imagePath: null,
    imageMime: null,
    imageSizeBytes: null,
    createdBy: null,
    createdAt: "2026-08-10T10:00:00Z",
    updatedBy: null,
    updatedAt: "2026-08-10T10:00:00Z",
    ...overrides,
  };
}

function alternativas(): SurveyOption[] {
  return [
    { id: "o-1", position: 1, text: "Aumentar muito", active: true },
    { id: "o-2", position: 2, text: "Aumentar", active: true },
    { id: "o-3", position: 3, text: "Manter", active: true },
    { id: "o-4", position: 4, text: "Reduzir", active: true },
    { id: "o-5", position: 5, text: "Reduzir muito", active: true },
  ];
}

describe("surveyStage", () => {
  it("rascunho, agendada, encerrada e cancelada saem do próprio status", () => {
    expect(surveyStage(enquete({ status: "draft" }), AGORA)).toBe("draft");
    expect(surveyStage(enquete({ status: "scheduled" }), AGORA)).toBe("scheduled");
    expect(surveyStage(enquete({ status: "closed" }), AGORA)).toBe("closed");
    expect(surveyStage(enquete({ status: "cancelled" }), AGORA)).toBe("cancelled");
  });

  it("ativa dentro da janela está recebendo respostas", () => {
    expect(surveyStage(enquete(), AGORA)).toBe("open");
  });

  it("§16 ATIVA com a data de encerramento vencida vira 'prazo encerrado'", () => {
    // O caso que justifica a função existir: nenhuma rotina rodou, o `status`
    // continua 'active', e o banco JÁ recusa resposta. A tela precisa dizer isso.
    const vencida = enquete({ endsAt: "2026-08-14T11:59:00Z" });
    expect(surveyStage(vencida, AGORA)).toBe("expired");
    expect(isAcceptingResponses(vencida, AGORA)).toBe(false);
  });

  it("o instante EXATO do encerramento já fecha a urna", () => {
    // `>=`, não `>`: a urna fecha NO instante marcado, e não um milissegundo
    // depois. É a mesma comparação do portão no banco.
    expect(surveyStage(enquete({ endsAt: "2026-08-14T12:00:00Z" }), AGORA)).toBe("expired");
  });

  it("ativa antes do início ainda não abriu", () => {
    const futura = enquete({ startsAt: "2026-08-15T08:00:00Z" });
    expect(surveyStage(futura, AGORA)).toBe("scheduled");
    expect(isAcceptingResponses(futura, AGORA)).toBe(false);
  });

  it("o instante EXATO do início já abre a urna", () => {
    expect(surveyStage(enquete({ startsAt: "2026-08-14T12:00:00Z" }), AGORA)).toBe("open");
  });

  it("ativa sem janela definida fica aberta", () => {
    expect(surveyStage(enquete({ startsAt: null, endsAt: null }), AGORA)).toBe("open");
  });

  it("cancelada vencida continua cancelada — o cancelamento vem primeiro", () => {
    const morta = enquete({ status: "cancelled", endsAt: "2026-01-01T00:00:00Z" });
    expect(surveyStage(morta, AGORA)).toBe("cancelled");
  });
});

describe("participationRate (§52)", () => {
  it("respostas sobre entregues, em percentual", () => {
    expect(participationRate(25, 100)).toBe(25);
    expect(participationRate(1, 3)).toBe(33.33);
  });

  it("sem nada entregue devolve 0, e não divisão por zero", () => {
    expect(participationRate(0, 0)).toBe(0);
    expect(participationRate(5, 0)).toBe(0);
  });

  it("todo mundo que recebeu respondeu = 100%", () => {
    expect(participationRate(7, 7)).toBe(100);
  });
});

describe("optionPercentage (§53)", () => {
  it("a alternativa sobre o total de respostas", () => {
    expect(optionPercentage(2, 4)).toBe(50);
    expect(optionPercentage(1, 3)).toBe(33.33);
  });

  it("sem respostas, 0% — nunca NaN", () => {
    expect(optionPercentage(0, 0)).toBe(0);
    expect(Number.isNaN(optionPercentage(0, 0))).toBe(false);
  });

  it("os percentuais de uma apuração real somam ~100", () => {
    const total = 7;
    const soma = [3, 2, 1, 1, 0].reduce((acc, n) => acc + optionPercentage(n, total), 0);
    expect(soma).toBeCloseTo(100, 1);
  });
});

describe("resolveOptionByPosition (§43, §44)", () => {
  it("casa o número digitado com a alternativa daquela posição", () => {
    expect(resolveOptionByPosition(alternativas(), "3")?.text).toBe("Manter");
    expect(resolveOptionByPosition(alternativas(), " 1 ")?.text).toBe("Aumentar muito");
  });

  it("§44 recusa um número fora da lista", () => {
    expect(resolveOptionByPosition(alternativas(), "6")).toBeNull();
    expect(resolveOptionByPosition(alternativas(), "0")).toBeNull();
  });

  it("§45 recusa texto livre em vez de tentar adivinhar a intenção", () => {
    expect(resolveOptionByPosition(alternativas(), "acho que vai aumentar")).toBeNull();
    expect(resolveOptionByPosition(alternativas(), "manter")).toBeNull();
    expect(resolveOptionByPosition(alternativas(), "")).toBeNull();
  });

  it("NÃO cai na armadilha do parseInt", () => {
    // `parseInt("3 opções")` devolve 3 e `parseInt("1.5")` devolve 1 — as duas
    // frases são qualquer coisa menos a escolha de uma alternativa.
    expect(resolveOptionByPosition(alternativas(), "3 opções")).toBeNull();
    expect(resolveOptionByPosition(alternativas(), "1.5")).toBeNull();
    expect(resolveOptionByPosition(alternativas(), "2a")).toBeNull();
  });

  it("ignora alternativa INATIVA, mesmo com a posição certa", () => {
    // §61: uma alternativa aposentada continua no resultado histórico, mas
    // ninguém pode votar nela hoje.
    const comInativa = alternativas().map((o) => (o.position === 3 ? { ...o, active: false } : o));
    expect(resolveOptionByPosition(comInativa, "3")).toBeNull();
    expect(resolveOptionByPosition(comInativa, "4")?.text).toBe("Reduzir");
  });

  it("casa por POSIÇÃO, não por índice do array", () => {
    // O detalhe que faz o voto no 3 não virar o 4: a lista pode chegar sem a
    // primeira alternativa, e a numeração que a pessoa viu continua valendo.
    const semAPrimeira = alternativas().slice(1);
    expect(resolveOptionByPosition(semAPrimeira, "2")?.text).toBe("Aumentar");
    expect(resolveOptionByPosition(semAPrimeira, "1")).toBeNull();
  });
});

describe("responseMessage (§44 a §50)", () => {
  it("cada desfecho tem o texto exato do escopo", () => {
    expect(responseMessage("registered")).toBe(SURVEY_RESPONSE_THANKS);
    expect(responseMessage("already_answered")).toBe(SURVEY_RESPONSE_ALREADY);
    expect(responseMessage("invalid_option")).toBe(SURVEY_RESPONSE_INVALID);
    expect(responseMessage("closed")).toBe(SURVEY_RESPONSE_CLOSED);
  });

  it("cancelada, não ativa e inexistente colapsam na mesma frase", () => {
    // De propósito: para quem está de fora, as três dizem a mesma coisa útil, e
    // distinguir revelaria o estado interno de uma campanha.
    expect(responseMessage("cancelled")).toBe(SURVEY_RESPONSE_UNAVAILABLE);
    expect(responseMessage("not_active")).toBe(SURVEY_RESPONSE_UNAVAILABLE);
    expect(responseMessage("not_found")).toBe(SURVEY_RESPONSE_UNAVAILABLE);
  });

  it("nenhuma frase vaza detalhe técnico", () => {
    const desfechos = [
      "registered",
      "already_answered",
      "invalid_option",
      "closed",
      "cancelled",
      "not_active",
      "not_found",
    ] as const;

    for (const d of desfechos) {
      const texto = responseMessage(d);
      expect(texto).not.toMatch(/survey|SV0|PGRST|null|undefined|error/i);
      expect(texto.length).toBeGreaterThan(10);
    }
  });
});

describe("canEditStructure (§60, §61)", () => {
  it("sem respostas, rascunho, agendada e ativa podem mudar a pergunta", () => {
    expect(canEditStructure("draft", false)).toBe(true);
    expect(canEditStructure("scheduled", false)).toBe(true);
    // O §60 condiciona a proibição a "se já existirem respostas" — uma ativa
    // ainda sem voto pode ser corrigida.
    expect(canEditStructure("active", false)).toBe(true);
  });

  it("COM respostas, nenhuma situação permite", () => {
    expect(canEditStructure("draft", true)).toBe(false);
    expect(canEditStructure("scheduled", true)).toBe(false);
    expect(canEditStructure("active", true)).toBe(false);
  });

  it("encerrada e cancelada nunca, com ou sem respostas", () => {
    expect(canEditStructure("closed", false)).toBe(false);
    expect(canEditStructure("cancelled", false)).toBe(false);
  });
});

describe("as permissões por situação", () => {
  const todas: SurveyStatus[] = ["draft", "scheduled", "active", "closed", "cancelled"];

  it("§10 só rascunho se exclui", () => {
    expect(todas.filter(canDelete)).toEqual(["draft"]);
  });

  it("§23/§33 o público só muda antes da fotografia", () => {
    expect(todas.filter(canEditAudience)).toEqual(["draft"]);
  });

  it("§9 agendar sai do rascunho; ativar sai da agendada", () => {
    expect(todas.filter(canActivate)).toEqual(["scheduled"]);
  });

  it("§58 só a ativa se encerra", () => {
    expect(todas.filter(canClose)).toEqual(["active"]);
  });

  it("§59 cancelar sai de qualquer situação não terminal", () => {
    expect(todas.filter(canCancel)).toEqual(["draft", "scheduled", "active"]);
  });

  it("§60 encerrada e cancelada não se editam", () => {
    expect(todas.filter(canEditDetails)).toEqual(["draft", "scheduled", "active"]);
  });
});

describe("isAudienceDimensionAvailable (GAP 1)", () => {
  it("as quatro que resolvem contra dados reais estão liberadas", () => {
    expect(isAudienceDimensionAvailable("all")).toBe(true);
    expect(isAudienceDimensionAvailable("region")).toBe(true);
    expect(isAudienceDimensionAvailable("profile")).toBe(true);
    expect(isAudienceDimensionAvailable("contact")).toBe(true);
  });

  it("as três que dependem do cadastro de associados estão bloqueadas", () => {
    expect(isAudienceDimensionAvailable("segment")).toBe(false);
    expect(isAudienceDimensionAvailable("category")).toBe(false);
    expect(isAudienceDimensionAvailable("portfolio")).toBe(false);
  });
});

describe("isWindowValid (§17)", () => {
  it("o fim tem de ser ESTRITAMENTE posterior ao início", () => {
    expect(isWindowValid("2026-08-14T10:00:00Z", "2026-08-14T11:00:00Z")).toBe(true);
    expect(isWindowValid("2026-08-14T10:00:00Z", "2026-08-14T10:00:00Z")).toBe(false);
    expect(isWindowValid("2026-08-14T11:00:00Z", "2026-08-14T10:00:00Z")).toBe(false);
  });

  it("janela incompleta não é inválida — só não foi preenchida ainda", () => {
    expect(isWindowValid(null, "2026-08-14T10:00:00Z")).toBe(true);
    expect(isWindowValid("2026-08-14T10:00:00Z", null)).toBe(true);
    expect(isWindowValid(null, null)).toBe(true);
  });
});

describe("isDispatchAfterStart (§35)", () => {
  it("enviar depois de abrir é o normal; junto também vale", () => {
    expect(isDispatchAfterStart("2026-08-14T00:00:00Z", "2026-08-14T09:00:00Z")).toBe(true);
    expect(isDispatchAfterStart("2026-08-14T09:00:00Z", "2026-08-14T09:00:00Z")).toBe(true);
  });

  it("enviar ANTES de abrir é recusado — o convite chegaria antes da urna", () => {
    expect(isDispatchAfterStart("2026-08-14T09:00:00Z", "2026-08-14T08:00:00Z")).toBe(false);
  });
});
