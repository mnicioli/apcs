import { describe, expect, it } from "vitest";
import {
  acceptsRegistrations,
  canCloseLanding,
  canDeactivateLanding,
  canPublishLanding,
  compareLandingPages,
  fitsCapacity,
  isValidSlug,
  landingEffectiveStatus,
  landingStatusReason,
  matchesLandingFilters,
  readLandingFields,
  resolveSuccessMessage,
  seatsLeft,
  slugPreview,
  slugWhileTyping,
  validateLandingFields,
  type LandingStatusInput,
} from "./event.landing.rules";
import type { LandingPageWithEvent } from "./event.landing.types";

/**
 * As regras de Landing Pages e Inscrições, uma a uma.
 *
 * ⚠️ ELAS SÃO A METADE DE LEITURA DE UMA REGRA QUE TEM DUAS METADES. A outra
 * vive no Postgres, sob lock, e é ela que garante — estes testes provam que a
 * TELA conta a mesma história que o banco vai contar. Quando uma regra mudar,
 * as duas mudam juntas, e é este arquivo que grita se só uma mudou.
 */

const AGORA = new Date("2026-09-10T12:00:00-03:00");

function pagina(overrides: Partial<LandingStatusInput> = {}): LandingStatusInput {
  return {
    status: "published",
    closesAt: null,
    maxParticipants: null,
    participantCount: 0,
    // Amanhã, em relação a `AGORA`: o padrão das fixtures é um evento que ainda
    // vai acontecer, para os casos de prazo e de lotação não serem mascarados
    // pela regra da data do evento.
    eventDate: "2026-09-11",
    ...overrides,
  };
}

describe("situação efetiva da landing page", () => {
  it("publicada, sem prazo e sem limite, aceita inscrição", () => {
    expect(landingEffectiveStatus(pagina(), AGORA)).toBe("published");
    expect(landingStatusReason(pagina(), AGORA)).toBeNull();
    expect(acceptsRegistrations(pagina(), AGORA)).toBe(true);
  });

  it("rascunho não aceita, e o motivo diz para publicar", () => {
    const p = pagina({ status: "draft" });
    expect(landingEffectiveStatus(p, AGORA)).toBe("draft");
    expect(landingStatusReason(p, AGORA)).toBe("draft");
    expect(acceptsRegistrations(p, AGORA)).toBe(false);
  });

  it("prazo vencido encerra sem ninguém ter gravado nada", () => {
    const p = pagina({ closesAt: "2026-09-09T23:59:00-03:00" });
    expect(landingEffectiveStatus(p, AGORA)).toBe("closed");
    expect(landingStatusReason(p, AGORA)).toBe("expired");
    expect(acceptsRegistrations(p, AGORA)).toBe(false);
  });

  it("o prazo é inclusivo até o instante exato", () => {
    // Um segundo antes ainda aceita; um segundo depois, não. O `>` de
    // `isPastDeadline` espelha o `now() > closes_at` da função Postgres.
    expect(acceptsRegistrations(pagina({ closesAt: "2026-09-10T12:00:01-03:00" }), AGORA)).toBe(
      true,
    );
    expect(acceptsRegistrations(pagina({ closesAt: "2026-09-10T11:59:59-03:00" }), AGORA)).toBe(
      false,
    );
  });

  it("lotação encerra, e o motivo é diferente do prazo", () => {
    const p = pagina({ maxParticipants: 10, participantCount: 10 });
    expect(landingEffectiveStatus(p, AGORA)).toBe("closed");
    // ⚠️ A DISTINÇÃO É O QUE FAZ A TELA SERVIR: "lotou" manda aumentar a
    // capacidade; "venceu" manda estender o prazo. Duas providências opostas.
    expect(landingStatusReason(p, AGORA)).toBe("full");
  });

  it("prazo vence antes de a lotação ser consultada — a mesma ordem da gravação", () => {
    const p = pagina({
      closesAt: "2026-09-01T00:00:00-03:00",
      maxParticipants: 10,
      participantCount: 10,
    });
    // `create_event_registration` recusa por RG001 (prazo) antes de chegar à
    // etapa de capacidade. A leitura conta a mesma história.
    expect(landingStatusReason(p, AGORA)).toBe("expired");
  });

  /**
   * ⚠️ A PROPRIEDADE CENTRAL DO DESENHO: A DERIVAÇÃO SÓ SABE REBAIXAR.
   *
   * É o que torna "encerramento automático não ressuscita página inativada" uma
   * impossibilidade estrutural em vez de uma regra a lembrar. Herdado de
   * `effectiveStatus` em Eventos.
   */
  it("a derivação nunca promove: inativa com prazo e vaga continua inativa", () => {
    const p = pagina({
      status: "inactive",
      closesAt: "2027-01-01T00:00:00-03:00",
      maxParticipants: 100,
      participantCount: 0,
    });
    expect(landingEffectiveStatus(p, AGORA)).toBe("inactive");
    expect(landingStatusReason(p, AGORA)).toBe("inactive");
  });

  it("encerrada à mão continua encerrada, e o motivo é manual", () => {
    const p = pagina({ status: "closed" });
    expect(landingStatusReason(p, AGORA)).toBe("manual");
  });

  /**
   * Data ilegível não fecha a página. Uma string corrompida em `closes_at`
   * mandaria gente embora sem motivo — e o banco continua sendo a barreira.
   */
  it("prazo ilegível não encerra as inscrições", () => {
    expect(acceptsRegistrations(pagina({ closesAt: "não é uma data" }), AGORA)).toBe(true);
  });
});

describe("capacidade", () => {
  it("sem limite significa vagas infinitas", () => {
    expect(seatsLeft(pagina())).toBeNull();
    expect(fitsCapacity(pagina(), 500)).toBe(true);
  });

  it("conta PESSOAS, não inscrições (§14)", () => {
    // O exemplo do escopo: capacidade 100, inscrições de 5, 3 e 10 = 18 pessoas.
    const p = pagina({ maxParticipants: 100, participantCount: 18 });
    expect(seatsLeft(p)).toBe(82);
  });

  it("a inscrição inteira cabe, ou nenhuma parte dela cabe", () => {
    const p = pagina({ maxParticipants: 100, participantCount: 97 });
    expect(fitsCapacity(p, 3)).toBe(true);
    // ⚠️ Cinco pessoas com três vagas é RECUSA, e não "aceita três". Aceitar
    // parte deixaria a granja sem saber quem ficou de fora.
    expect(fitsCapacity(p, 5)).toBe(false);
  });

  it("vaga nunca é negativa", () => {
    expect(seatsLeft(pagina({ maxParticipants: 10, participantCount: 15 }))).toBe(0);
  });
});

describe("transições (§5)", () => {
  it("publicar vale de qualquer situação, menos de publicada", () => {
    expect(canPublishLanding({ status: "draft" })).toBe(true);
    expect(canPublishLanding({ status: "closed" })).toBe(true);
    expect(canPublishLanding({ status: "inactive" })).toBe(true);
    expect(canPublishLanding({ status: "published" })).toBe(false);
  });

  it("encerrar só vale a partir do ar", () => {
    expect(canCloseLanding({ status: "published" })).toBe(true);
    // Encerrar um rascunho seria encerrar inscrições que nunca foram abertas.
    expect(canCloseLanding({ status: "draft" })).toBe(false);
  });

  it("tirar do ar vale de qualquer situação, menos de inativa", () => {
    expect(canDeactivateLanding({ status: "published" })).toBe(true);
    expect(canDeactivateLanding({ status: "inactive" })).toBe(false);
  });
});

describe("slug (§6)", () => {
  it("tira acento, caixa e pontuação", () => {
    expect(slugPreview("Encontro Técnico e Comercial")).toBe("encontro-tecnico-e-comercial");
    expect(slugPreview("Reunião de Produção — 2026")).toBe("reuniao-de-producao-2026");
  });

  it("colapsa hífens e não deixa nenhum nas pontas", () => {
    expect(slugPreview("  ***  APCS  ***  ")).toBe("apcs");
  });

  it("cedilha vira c e til vira n", () => {
    expect(slugPreview("Ação Ñandu")).toBe("acao-nandu");
  });

  it("aceita só o formato que o CHECK do banco aceita", () => {
    expect(isValidSlug("encontro-tecnico")).toBe(true);
    expect(isValidSlug("evento2026")).toBe(true);
    expect(isValidSlug("Encontro")).toBe(false);
    expect(isValidSlug("encontro--tecnico")).toBe(false);
    expect(isValidSlug("-encontro")).toBe(false);
    expect(isValidSlug("ab")).toBe(false);
  });
});

describe("campos do formulário (§7, §8)", () => {
  const PADRAO = ["GRANJA_EMPRESA", "EMAIL", "NOME_PARTICIPANTE", "TELEFONE", "WHATSAPP"];

  it("a configuração padrão é válida", () => {
    expect(validateLandingFields(PADRAO)).toBeNull();
  });

  it("a ordem pode ser qualquer uma — é isso que o Builder vai arrastar", () => {
    expect(
      validateLandingFields(["EMAIL", "GRANJA_EMPRESA", "WHATSAPP", "NOME_PARTICIPANTE"]),
    ).toBeNull();
  });

  it("recusa campo desconhecido", () => {
    expect(validateLandingFields([...PADRAO, "CPF"])).toBe("unknownField");
  });

  it("recusa campo repetido", () => {
    expect(validateLandingFields([...PADRAO, "EMAIL"])).toBe("duplicateField");
  });

  it("recusa formulário sem um dos três obrigatórios", () => {
    expect(validateLandingFields(["GRANJA_EMPRESA", "EMAIL", "TELEFONE"])).toBe("missingRequired");
  });

  /**
   * ⚠️ A REGRA QUE NÃO É ÓBVIA. Sem TELEFONE nem WHATSAPP no formulário,
   * nenhum participante conseguiria satisfazer o §8 ("pelo menos um dos dois"),
   * e a página nasceria incapaz de aceitar uma única inscrição.
   */
  it("recusa formulário sem nenhum campo de contato", () => {
    expect(validateLandingFields(["GRANJA_EMPRESA", "EMAIL", "NOME_PARTICIPANTE"])).toBe(
      "missingContact",
    );
  });

  it("um só dos dois contatos basta", () => {
    expect(
      validateLandingFields(["GRANJA_EMPRESA", "EMAIL", "NOME_PARTICIPANTE", "WHATSAPP"]),
    ).toBeNull();
  });

  it("recusa lista vazia", () => {
    expect(validateLandingFields([])).toBe("empty");
  });
});

describe("leitura defensiva dos campos gravados", () => {
  it("lê a lista quando ela é válida", () => {
    expect(readLandingFields(["EMAIL", "GRANJA_EMPRESA", "NOME_PARTICIPANTE", "TELEFONE"])).toEqual(
      ["EMAIL", "GRANJA_EMPRESA", "NOME_PARTICIPANTE", "TELEFONE"],
    );
  });

  /**
   * `form_fields` é jsonb: o que chega pode ser qualquer coisa se alguém editou
   * a linha por fora. Uma página que mostra o formulário padrão ainda coleta
   * inscrição; uma página que não abre, não.
   */
  it("cai no padrão diante de lixo, em vez de derrubar a tela", () => {
    const padrao = ["GRANJA_EMPRESA", "EMAIL", "NOME_PARTICIPANTE", "TELEFONE", "WHATSAPP"];
    expect(readLandingFields(null)).toEqual(padrao);
    expect(readLandingFields("EMAIL")).toEqual(padrao);
    expect(readLandingFields({ campos: [] })).toEqual(padrao);
    // Descarta o desconhecido; o que sobra não satisfaz o §8, então vai ao padrão.
    expect(readLandingFields(["CPF", "RG"])).toEqual(padrao);
  });
});

describe("mensagem de confirmação (§18)", () => {
  const PADRAO = {
    title: "INSCRIÇÃO CONFIRMADA!",
    message: "Seu cadastro para o <EVENTO> foi realizado com sucesso.",
    footer: "Esperamos você! Nos vemos no evento.",
  };

  const EVENTO = {
    name: "Encontro Técnico",
    eventDate: "2026-09-18",
    startTime: "08:00",
    endTime: "13:00",
  };

  it("usa o padrão da plataforma quando a página não define nada", () => {
    const resolvido = resolveSuccessMessage(
      { successTitle: null, successMessage: null, successFooter: null },
      PADRAO,
      EVENTO,
    );
    expect(resolvido.title).toBe("INSCRIÇÃO CONFIRMADA!");
    expect(resolvido.message).toBe(
      "Seu cadastro para o Encontro Técnico foi realizado com sucesso.",
    );
  });

  it("a página sobrescreve pedaço a pedaço, sem tudo ou nada", () => {
    const resolvido = resolveSuccessMessage(
      { successTitle: "TUDO CERTO!", successMessage: null, successFooter: null },
      PADRAO,
      EVENTO,
    );
    expect(resolvido.title).toBe("TUDO CERTO!");
    // O que ela não definiu continua vindo do padrão.
    expect(resolvido.footer).toBe("Esperamos você! Nos vemos no evento.");
  });

  it("substitui os marcadores no texto da própria página", () => {
    const resolvido = resolveSuccessMessage(
      {
        successTitle: null,
        successMessage: "Nos vemos no <EVENTO>, dia <DATA>.",
        successFooter: null,
      },
      PADRAO,
      EVENTO,
    );
    expect(resolvido.message).toBe("Nos vemos no Encontro Técnico, dia 18/09/2026.");
  });

  /**
   * A data é formatada sem passar por `Date`. Passar traria fuso junto, e
   * "2026-09-18" viraria 17/09 para quem estivesse a oeste de Greenwich.
   */
  it("a data não desliza um dia por causa de fuso", () => {
    const resolvido = resolveSuccessMessage(
      { successTitle: null, successMessage: "<DATA>", successFooter: null },
      PADRAO,
      { name: "X", eventDate: "2026-01-01", startTime: "08:00", endTime: null },
    );
    expect(resolvido.message).toBe("01/01/2026");
  });
});

/* -------------------------------------------------------------------------- */
/* Filtros                                                                    */
/* -------------------------------------------------------------------------- */

function landing(overrides: Partial<LandingPageWithEvent> = {}): LandingPageWithEvent {
  return {
    id: "l1",
    eventId: "e1",
    status: "published",
    slug: "encontro-tecnico",
    description: null,
    imageUrl: null,
    formFields: ["GRANJA_EMPRESA", "EMAIL", "NOME_PARTICIPANTE", "TELEFONE", "WHATSAPP"],
    successTitle: null,
    successMessage: null,
    successFooter: null,
    closesAt: null,
    maxParticipants: null,
    participantCount: 0,
    createdBy: null,
    createdAt: "2026-09-01T10:00:00Z",
    updatedBy: null,
    updatedAt: "2026-09-01T10:00:00Z",
    publishedAt: null,
    publishedBy: null,
    event: {
      id: "e1",
      name: "Encontro Técnico",
      eventDate: "2026-09-18",
      startTime: "08:00",
      endTime: "13:00",
      location: "Toledo",
      description: null,
      imageUrl: null,
    },
    ...overrides,
  };
}

describe("filtros da grid de landing pages", () => {
  it("busca sem acento acha o evento com acento", () => {
    const filtros = { query: "tecnico", status: "all" as const, from: "", to: "" };
    expect(matchesLandingFilters(landing(), filtros, AGORA)).toBe(true);
  });

  /**
   * ⚠️ O FILTRO OLHA A SITUAÇÃO EFETIVA. Quem escolhe "Encerrada" quer ver
   * tanto as que alguém encerrou quanto as que venceram o prazo ou lotaram —
   * para quem olha a tela, as três são "não aceita mais inscrição".
   */
  it("uma página publicada mas vencida aparece no filtro de encerradas", () => {
    const vencida = landing({ closesAt: "2026-09-01T00:00:00-03:00" });
    const filtros = { query: "", status: "closed" as const, from: "", to: "" };
    expect(matchesLandingFilters(vencida, filtros, AGORA)).toBe(true);

    const publicadas = { query: "", status: "published" as const, from: "", to: "" };
    expect(matchesLandingFilters(vencida, publicadas, AGORA)).toBe(false);
  });

  it("o período é inclusivo nas duas pontas", () => {
    const filtros = { query: "", status: "all" as const, from: "2026-09-18", to: "2026-09-18" };
    expect(matchesLandingFilters(landing(), filtros, AGORA)).toBe(true);
  });
});

describe("ordenação da grid", () => {
  it("os próximos primeiro; os passados no fim, do mais recente para o mais antigo", () => {
    const hoje = "2026-09-10";
    const proximo = landing({ id: "a", event: { ...landing().event, eventDate: "2026-09-18" } });
    const distante = landing({ id: "b", event: { ...landing().event, eventDate: "2026-12-01" } });
    const passado = landing({ id: "c", event: { ...landing().event, eventDate: "2026-08-01" } });
    const passadoAntigo = landing({
      id: "d",
      event: { ...landing().event, eventDate: "2024-01-01" },
    });

    const ordenado = [passadoAntigo, distante, passado, proximo]
      .sort((a, b) => compareLandingPages(a, b, hoje))
      .map((p) => p.id);

    expect(ordenado).toEqual(["a", "b", "c", "d"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Inscrições                                                                 */
/* -------------------------------------------------------------------------- */

/*
 * ⚠️ OS TESTES DE `matchesRegistrationFilters` E `countByConfirmation` SAÍRAM
 * DAQUI NA HOMOLOGAÇÃO, JUNTO COM AS FUNÇÕES.
 *
 * As duas eram o filtro e a contagem EM MEMÓRIA que o Prompt 1 preparou para a
 * tela de Inscrições. O Prompt 4 passou as duas responsabilidades para o banco
 * (`event_registrations_board`), onde a busca atravessa as duas tabelas e os
 * indicadores saem do mesmo `where` das linhas.
 *
 * Apagar os testes junto com o código é o certo: um teste verde sobre função
 * que ninguém chama afirma uma garantia que não protege nada — e mantém vivo o
 * caminho que traz mil linhas de dado pessoal para a memória do servidor.
 *
 * As invariantes que substituíram estas estão em `src/test/sql-event-landing.test.ts`
 * (a busca, os contadores, a ordenação estável) e nos testes da grid.
 */

/**
 * ============================================================================
 * ⚠️ O DEFEITO QUE UM TESTE DE COMPONENTE ENCONTROU, GUARDADO AQUI EM BAIXO.
 * ============================================================================
 * O campo de endereço do Builder normaliza a cada tecla. Com `slugPreview` ali,
 * digitar "Encontro Técnico" produzia **"encontrotecnico"** — o separador
 * desaparecia no instante entre a barra de espaço e a letra seguinte, e um
 * endereço de duas palavras ficava impossível de escrever.
 *
 * Eram DUAS causas somadas, e as duas estão cobertas abaixo:
 *
 *   1. `normalizeForSearch` termina com `.trim()`, então "Encontro " chegava ao
 *      gerador já sem o espaço — o hífen nunca era criado.
 *   2. `slugPreview` corta hífen das pontas, então mesmo criado ele seria
 *      apagado antes da próxima tecla.
 */
describe("slug enquanto se digita", () => {
  it("preserva o separador de uma palavra que ainda não terminou", () => {
    expect(slugWhileTyping("Encontro ")).toBe("encontro-");
    expect(slugWhileTyping("Encontro T")).toBe("encontro-t");
    expect(slugWhileTyping("Encontro Técnico")).toBe("encontro-tecnico");
  });

  it("digitar letra a letra chega ao mesmo lugar que digitar de uma vez", () => {
    const alvo = "Encontro Técnico e Comercial";
    let digitado = "";
    for (const letra of alvo) digitado = slugWhileTyping(digitado + letra);

    expect(digitado).toBe(slugWhileTyping(alvo));
    expect(digitado).toBe("encontro-tecnico-e-comercial");
  });

  it("a versão final corta as pontas; a de digitação não", () => {
    expect(slugWhileTyping("  Encontro  ")).toBe("-encontro-");
    expect(slugPreview("  Encontro  ")).toBe("encontro");
  });

  it("as duas concordam em tudo o que não é ponta", () => {
    for (const entrada of ["Ação Ñandu", "Reunião — 2026", "APCS/CSPI"]) {
      expect(slugPreview(entrada)).toBe(slugWhileTyping(entrada).replace(/^-+|-+$/g, ""));
    }
  });
});

describe("§5 e §17 do Prompt 5 — evento que já aconteceu", () => {
  /**
   * ==========================================================================
   * ⚠️ O BURACO QUE A HOMOLOGAÇÃO ENCONTROU.
   * ==========================================================================
   * O prazo é OPCIONAL: o Builder o oferece com o início do evento como padrão,
   * e quem edita pode limpar o campo. Uma página publicada, sem prazo e sem
   * capacidade, aceitava inscrição para um evento de 2024 — indefinidamente,
   * porque nem a tela nem o banco olhavam a data do evento.
   *
   * O resultado seria dado sujo que ninguém percebe até alguém exportar a
   * planilha: gente inscrita, meses depois, num encontro que já aconteceu.
   */
  it("evento de ontem fecha as inscrições, mesmo sem prazo e sem lotação", () => {
    const p = pagina({ eventDate: "2026-09-09" });

    expect(landingEffectiveStatus(p, AGORA)).toBe("closed");
    expect(landingStatusReason(p, AGORA)).toBe("eventPassed");
    expect(acceptsRegistrations(p, AGORA)).toBe(false);
  });

  /**
   * ⚠️ NO DIA DO EVENTO AINDA ACEITA. É a diferença entre a DATA e o HORÁRIO:
   * "o evento começou às 8h e agora são 9h" é trabalho do PRAZO, que por padrão
   * é o início do evento e que quem organiza pode estender de propósito —
   * inscrição na portaria acontece.
   */
  it("no próprio dia do evento continua aceitando", () => {
    expect(acceptsRegistrations(pagina({ eventDate: "2026-09-10" }), AGORA)).toBe(true);
  });

  /**
   * ⚠️ A ORDEM É A MESMA DA GRAVAÇÃO: o banco recusa por RG009 (evento passou)
   * ANTES de chegar ao prazo (RG001) e à capacidade (RG002). Se a leitura
   * respondesse "lotou" onde o banco diz "o evento já aconteceu", a tela mandaria
   * quem administra aumentar uma capacidade que não resolveria nada.
   */
  it("o evento passado vence o prazo e a lotação como motivo", () => {
    const p = pagina({
      eventDate: "2026-09-01",
      closesAt: "2026-08-01T00:00:00-03:00",
      maxParticipants: 10,
      participantCount: 10,
    });
    expect(landingStatusReason(p, AGORA)).toBe("eventPassed");
  });

  /**
   * ⚠️ A DERIVAÇÃO CONTINUA SÓ REBAIXANDO. Um evento no futuro não reabre uma
   * página que alguém tirou do ar — é a propriedade central do desenho, e a
   * regra nova não podia quebrá-la.
   */
  it("evento futuro não ressuscita página inativada", () => {
    const p = pagina({ status: "inactive", eventDate: "2027-01-01" });
    expect(landingEffectiveStatus(p, AGORA)).toBe("inactive");
  });

  /**
   * ⚠️ COMPARA STRING AAAA-MM-DD, sem passar por `Date`. `new Date("2026-09-10")`
   * é meia-noite UTC, que em São Paulo é 21h do dia ANTERIOR — a página fecharia
   * um dia cedo. Este caso é a fronteira exata: às 00h05 de São Paulo do dia do
   * evento, ainda é o dia do evento.
   */
  it("a virada do dia segue o calendário de São Paulo", () => {
    const madrugada = new Date("2026-09-10T00:05:00-03:00");
    expect(acceptsRegistrations(pagina({ eventDate: "2026-09-10" }), madrugada)).toBe(true);
    expect(acceptsRegistrations(pagina({ eventDate: "2026-09-09" }), madrugada)).toBe(false);
  });
});
