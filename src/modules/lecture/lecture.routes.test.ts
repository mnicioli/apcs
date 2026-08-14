import { describe, expect, it } from "vitest";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  isLectureFiltered,
  isLectureId,
  lectureCalendarHref,
  lectureFiltersToParams,
  lecturesHref,
  parseCalendarState,
  parseLecturePage,
  parseLectureSort,
  parseLectureFilters,
} from "./lecture.routes";
import { EMPTY_LECTURE_FILTERS, type LectureFilters } from "./lecture.types";

const CHEIO: LectureFilters = {
  query: "câmara",
  status: ["planned", "confirmed"],
  origin: "chatbot",
  type: "associate",
  format: "in_person",
  priority: "high",
  city: "Toledo",
  responsibleId: "11111111-1111-4111-8111-111111111111",
  speakerId: "22222222-2222-4222-8222-222222222222",
  from: "2026-08-01",
  to: "2026-08-31",
};

describe("filtros na URL (§11, §19)", () => {
  it("vai e volta sem perder nada", () => {
    const params = lectureFiltersToParams(CHEIO);
    const volta = parseLectureFilters(Object.fromEntries(params.entries()));
    expect(volta).toEqual(CHEIO);
  });

  it("não escreve parâmetro vazio", () => {
    expect(lectureFiltersToParams(EMPTY_LECTURE_FILTERS).toString()).toBe("");
  });

  it("aceita status separado por vírgula e repetido", () => {
    expect(parseLectureFilters({ status: "planned,confirmed" }).status).toEqual([
      "planned",
      "confirmed",
    ]);
    expect(parseLectureFilters({ status: ["confirmed", "planned"] }).status).toEqual([
      "planned",
      "confirmed",
    ]);
  });

  /**
   * ⚠️ Um valor arbitrário da URL NUNCA chega ao SQL. Ele é comparado contra a
   * lista fechada do domínio e, se não estiver lá, vira "sem filtro" — e não
   * uma lista vazia: uma URL colada errada não deve parecer "não há nada aqui".
   */
  it("descarta valor que não pertence ao domínio", () => {
    const sujo = parseLectureFilters({
      status: "realizada; drop table",
      origin: "telepatia",
      type: "'; select 1",
      responsible: "não-é-uuid",
      from: "2026-02-31",
    });

    expect(sujo.status).toEqual([]);
    expect(sujo.origin).toBeNull();
    expect(sujo.type).toBeNull();
    expect(sujo.responsibleId).toBeNull();
    expect(sujo.from).toBe("");
  });

  it("sabe se há filtro ativo", () => {
    expect(isLectureFiltered(EMPTY_LECTURE_FILTERS)).toBe(false);
    expect(isLectureFiltered(CHEIO)).toBe(true);
    expect(isLectureFiltered({ ...EMPTY_LECTURE_FILTERS, query: "   " })).toBe(false);
  });
});

describe("§48 os filtros sobrevivem à troca de tela", () => {
  it("o link do calendário carrega os filtros da grid", () => {
    const href = lectureCalendarHref({ filters: CHEIO });
    const params = new URLSearchParams(href.split("?")[1]);

    expect(parseLectureFilters(Object.fromEntries(params.entries()))).toEqual(CHEIO);
  });

  it("o link da grid carrega os filtros do calendário", () => {
    const href = lecturesHref({ filters: CHEIO });
    const params = new URLSearchParams(href.split("?")[1]);

    expect(parseLectureFilters(Object.fromEntries(params.entries()))).toEqual(CHEIO);
  });

  it("sem filtro, o endereço fica limpo", () => {
    expect(lecturesHref()).toBe("/lectures");
    expect(lectureCalendarHref()).toBe("/lectures/calendar");
  });
});

describe("ordenação e paginação (§17, §18)", () => {
  it("tem padrão sensato", () => {
    expect(parseLectureSort({})).toEqual({ field: "requestedAt", ascending: false });
    expect(parseLecturePage({})).toEqual({ page: 1, pageSize: 25 });
  });

  it("só ordena por coluna da lista fechada", () => {
    expect(parseLectureSort({ sort: "city", dir: "asc" })).toEqual({
      field: "city",
      ascending: true,
    });
    expect(parseLectureSort({ sort: "notes; drop table" }).field).toBe("requestedAt");
  });

  it("recusa página e tamanho impossíveis", () => {
    expect(parseLecturePage({ page: "0" }).page).toBe(1);
    expect(parseLecturePage({ page: "abc" }).page).toBe(1);
    expect(parseLecturePage({ size: "5000" }).pageSize).toBe(25);
    expect(parseLecturePage({ size: "50" }).pageSize).toBe(50);
  });

  it("a ordem padrão não polui a URL", () => {
    expect(lecturesHref({ sort: { field: "requestedAt", ascending: false } })).toBe("/lectures");
    expect(lecturesHref({ sort: { field: "city", ascending: true } })).toBe(
      "/lectures?sort=city&dir=asc",
    );
  });
});

describe("estado do calendário (§2)", () => {
  const hoje = "2026-08-13";

  it("abre na visão mensal, no mês de hoje", () => {
    expect(parseCalendarState({}, hoje)).toEqual({ view: "month", anchor: "2026-08-01" });
  });

  it("normaliza a âncora para a visão pedida", () => {
    expect(parseCalendarState({ view: "week", date: "2026-08-15" }, hoje)).toEqual({
      view: "week",
      anchor: "2026-08-10",
    });
  });

  it("visão ou data inválida cai no padrão em vez de quebrar", () => {
    expect(parseCalendarState({ view: "década", date: "2026-02-31" }, hoje)).toEqual({
      view: "month",
      anchor: "2026-08-01",
    });
  });
});

/**
 * §78 — o lado do frontend.
 *
 * A matriz é a 1ª camada; a RLS do banco é a 2ª, e ela foi provada à parte com
 * 158 casos SQL rodados contra o banco real (bloco J). Aqui só se trava o
 * recorte que as telas consultam para decidir o que oferecer.
 */
describe("§60 permissões por perfil", () => {
  it("Administrador e Gestor leem e escrevem", () => {
    for (const role of ["admin", "ceo"] as const) {
      expect(hasPermission(role, "lectures.read"), role).toBe(true);
      expect(hasPermission(role, "lectures.write"), role).toBe(true);
    }
  });

  it("Atendente só VISUALIZA", () => {
    expect(hasPermission("comercial", "lectures.read")).toBe(true);
    expect(hasPermission("comercial", "lectures.write")).toBe(false);
  });

  it("os demais papéis não veem o módulo", () => {
    for (const role of ["pm", "tech_lead", "financeiro", "viewer"] as const) {
      expect(hasPermission(role, "lectures.read"), role).toBe(false);
      expect(hasPermission(role, "lectures.write"), role).toBe(false);
    }
  });
});

describe("isLectureId", () => {
  it("aceita um uuid", () => {
    expect(isLectureId("741e2cc7-b735-4bf9-b161-fd457c4c48e1")).toBe(true);
    expect(isLectureId("741E2CC7-B735-4BF9-B161-FD457C4C48E1")).toBe(true);
  });

  /**
   * O caso que originou a função: `/lectures/nao-e-uuid` chegava ao banco, o
   * Postgres recusava e a pessoa via "Não foi possível carregar" — tela de falha
   * do sistema para o que é só um endereço que não existe.
   */
  it("recusa o que não tem forma de uuid", () => {
    for (const ruim of [
      "nao-e-uuid",
      "",
      "1",
      "1' OR '1'='1",
      "741e2cc7-b735-4bf9-b161",
      "741e2cc7-b735-4bf9-b161-fd457c4c48e1x",
      "741e2cc7_b735_4bf9_b161_fd457c4c48e1",
      "../../../etc/passwd",
      "%00",
    ]) {
      expect(isLectureId(ruim), ruim).toBe(false);
    }
  });

  it("não é âncora global — um uuid no meio de lixo não passa", () => {
    // Sem `^` e `$`, "lixo741e2cc7-...-fd457c4c48e1lixo" passaria e voltaria a
    // virar consulta.
    expect(isLectureId("lixo741e2cc7-b735-4bf9-b161-fd457c4c48e1")).toBe(false);
    expect(isLectureId("741e2cc7-b735-4bf9-b161-fd457c4c48e1lixo")).toBe(false);
  });
});
