import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/rbac/rbac.types";
import { hasPermission } from "@/lib/rbac/rbac.config";
import {
  evaluationParticipantActionSchema,
  evaluationSettingsSchema,
  evaluationStructureSchema,
  publicEvaluationSubmissionSchema,
} from "@/modules/event/event.evaluation.schema";
import {
  evaluationStage,
  publicEvaluationPath,
  renderEvaluationInvite,
  responseRate,
} from "@/modules/event/event.evaluation.rules";
import {
  EMPTY_EVALUATION_FILTERS,
  EVALUATION_QUESTION_TYPES,
  SINGLE_ANSWER_TYPES,
} from "@/modules/event/event.evaluation.types";
import {
  evaluationsHref,
  eventEvaluationHref,
  hasActiveEvaluationFilters,
  parseEvaluationFilters,
} from "@/modules/event/event.evaluation.routes";
import { EVALUATION_INVITE_FALLBACK } from "@/modules/event/event.evaluation.labels";

/**
 * A AVALIAÇÃO DE EVENTO, DA URL ATÉ A CHAMADA AO BANCO.
 *
 * ============================================================================
 * ⚠️ O QUE ESTE ARQUIVO EXERCITA DE VERDADE, E O QUE ELE NÃO ALCANÇA.
 * ============================================================================
 * Roda de verdade, sem mock: os schemas que aceitam e recusam, a serialização
 * dos filtros, as regras derivadas (etapa, taxa, montagem da mensagem), a
 * matriz de permissões e as actions inteiras — inclusive a checagem de RBAC,
 * com o papel real passando por `hasPermission`.
 *
 * O que ele NÃO alcança é o Postgres. Este projeto não sobe banco na bateria
 * (ver o cabeçalho de `sql-returns-table`), então a elegibilidade por presença,
 * a constraint de uma resposta, o token, a transação e o versionamento são
 * cobertos por `sql-event-evaluation.test.ts`, que lê as invariantes do texto
 * do SQL. Chamar isto de "teste de integração completo" seria mentir sobre a
 * garantia — e é justamente o tipo de afirmação que faz alguém pular a
 * homologação manual.
 *
 * O valor dele é outro e é real: ele prova que o QUE A TELA MANDA é o que o
 * banco espera receber — o evento junto (§28), sem valor de nota (§32), sem id
 * de participante (§29).
 */

const EVENTO = "11111111-1111-4111-8111-111111111111";
const OUTRO_EVENTO = "22222222-2222-4222-8222-222222222222";
const AVALIACAO = "33333333-3333-4333-8333-333333333333";
const MODELO = "55555555-5555-4555-8555-555555555555";
const PERGUNTA = "66666666-6666-4666-8666-666666666666";
const OPCAO = "77777777-7777-4777-8777-777777777777";
const TOKEN = "a".repeat(32);

/* -------------------------------------------------------------------------- */
/* As actions, com o papel real passando pelo RBAC                            */
/* -------------------------------------------------------------------------- */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/services/roles", () => ({
  ensureRoleMatrix: async () => [],
  invalidateRoleCache: () => {},
}));

const rpc = vi.hoisted(() => vi.fn());
const rpcAdmin = vi.hoisted(() => vi.fn());
let papelAtual: Role | null = "admin";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: papelAtual === null ? null : { id: "99999999-9999-4999-8999-999999999999" } },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          returns: () => ({
            maybeSingle: async () => ({
              data: papelAtual === null ? null : { role: papelAtual, active: true },
              error: null,
            }),
          }),
        }),
      }),
    }),
    rpc,
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: rpcAdmin }),
}));

const {
  applyEvaluationTemplateAction,
  cancelEvaluationAction,
  reopenEvaluationAction,
  resendEvaluationAction,
  saveEvaluationSettingsAction,
  saveEvaluationStructureAction,
} = await import("@/lib/actions/event-evaluation");

const { submitPublicEvaluationAction } = await import("@/lib/actions/event-evaluation-public");

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { eventId: EVENTO, enabled: true }, error: null });
  rpcAdmin.mockReset();
  rpcAdmin.mockResolvedValue({ data: { state: "answered" }, error: null });
  papelAtual = "admin";
});

function argumentos(mock: typeof rpc): Record<string, unknown> {
  return (mock.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
}

/* ========================================================================== */
/* §9, §10 — configuração de envio                                            */
/* ========================================================================== */

describe("§9 e §10 — a configuração de envio", () => {
  it("manda evento, situação, atraso e prazo", async () => {
    const resultado = await saveEvaluationSettingsAction({
      eventId: EVENTO,
      enabled: true,
      delayMinutes: 30,
      responseWindowDays: 7,
      templateId: MODELO,
    });

    expect(resultado.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("save_event_evaluation_settings", expect.anything());
    expect(argumentos(rpc)).toMatchObject({
      p_event_id: EVENTO,
      p_enabled: true,
      p_delay_minutes: 30,
      p_response_window_days: 7,
    });
  });

  /**
   * ⚠️ O ATRASO É SEMPRE MINUTOS NO PAYLOAD. A tela oferece "horas" como
   * conveniência e converte antes de chamar; guardar a unidade ao lado do número
   * obrigaria toda consulta do banco a multiplicar condicionalmente — inclusive
   * a que decide quem recebe agora.
   */
  it("aceita zero (enviar assim que o evento terminar) e recusa negativo", () => {
    const base = { eventId: EVENTO, enabled: true, responseWindowDays: null };
    expect(evaluationSettingsSchema.safeParse({ ...base, delayMinutes: 0 }).success).toBe(true);
    expect(evaluationSettingsSchema.safeParse({ ...base, delayMinutes: -1 }).success).toBe(false);
  });

  it("recusa atraso acima de sete dias — é o mesmo teto do CHECK do banco", () => {
    const base = { eventId: EVENTO, enabled: true, responseWindowDays: null };
    expect(evaluationSettingsSchema.safeParse({ ...base, delayMinutes: 10080 }).success).toBe(true);
    expect(evaluationSettingsSchema.safeParse({ ...base, delayMinutes: 10081 }).success).toBe(
      false,
    );
  });

  it("prazo nulo é válido — §20: sem prazo configurado, a avaliação continua disponível", () => {
    expect(
      evaluationSettingsSchema.safeParse({
        eventId: EVENTO,
        enabled: true,
        delayMinutes: 30,
        responseWindowDays: null,
      }).success,
    ).toBe(true);
  });

  it("prazo de zero dia é recusado — seria uma avaliação que nasce vencida", () => {
    expect(
      evaluationSettingsSchema.safeParse({
        eventId: EVENTO,
        enabled: true,
        delayMinutes: 30,
        responseWindowDays: 0,
      }).success,
    ).toBe(false);
  });
});

/* ========================================================================== */
/* §10 — o disparo depende do EVENTO, e não do check-in                       */
/* ========================================================================== */

describe("§10 — a etapa derivada do evento", () => {
  const base = {
    enabled: true,
    endTime: "18:00",
    sendAt: "2026-08-29T21:30:00Z",
    present: 10,
    sent: 0,
    answered: 0,
    queued: 10,
  };

  it("desligada vence tudo", () => {
    expect(evaluationStage({ ...base, enabled: false })).toBe("disabled");
  });

  /**
   * ⚠️ O CASO QUE ESTE MÓDULO INTEIRO EXISTE PARA NÃO ESQUECER. `events.end_time`
   * é OPCIONAL neste sistema, e sem ele não há "término + atraso" a calcular. A
   * tela precisa gritar isso antes do evento — se caísse em "aguardando", o
   * evento passaria e ninguém entenderia por que nada saiu.
   */
  it("habilitada sem horário de término é alerta, e não 'aguardando'", () => {
    expect(evaluationStage({ ...base, endTime: null, sendAt: null })).toBe("blocked_no_end_time");
  });

  it("antes da hora do disparo, aguardando", () => {
    expect(evaluationStage(base, new Date("2026-08-29T20:00:00Z"))).toBe("waiting");
  });

  it("passada a hora e com gente na fila, enviando", () => {
    expect(evaluationStage(base, new Date("2026-08-29T22:00:00Z"))).toBe("sending");
  });

  /**
   * ⚠️ ZERO ENVIADAS COM PRESENTES É "ENVIANDO", E NÃO "CONCLUÍDO". A rotina
   * ainda vai passar. Dizer "envio concluído" para um evento em que ninguém
   * recebeu nada é a mentira mais cara possível nesta coluna.
   */
  it("presentes e nada enviado ainda é 'enviando', mesmo com a fila zerada", () => {
    expect(
      evaluationStage(
        { ...base, queued: 0, sent: 0, answered: 0 },
        new Date("2026-08-29T22:00:00Z"),
      ),
    ).toBe("sending");
  });

  it("tudo enviado e fila vazia, concluído", () => {
    expect(
      evaluationStage(
        { ...base, queued: 0, sent: 10, answered: 4 },
        new Date("2026-08-29T22:00:00Z"),
      ),
    ).toBe("done");
  });
});

/* ========================================================================== */
/* §21 — a taxa de resposta                                                   */
/* ========================================================================== */

describe("§21 — a taxa de resposta", () => {
  /**
   * ⚠️ O DENOMINADOR É QUEM RECEBEU, e não quem esteve presente. Usar `present`
   * faria a taxa subir sozinha ao longo do dia, sem ninguém ter respondido nada.
   */
  it("é sobre as enviadas", () => {
    expect(responseRate(10, 4)).toBe(40);
  });

  it("sem envio nenhum devolve nulo, e não zero", () => {
    expect(responseRate(0, 0)).toBeNull();
  });

  it("arredonda para inteiro", () => {
    expect(responseRate(3, 1)).toBe(33);
  });
});

/* ========================================================================== */
/* §13 — a mensagem de convite                                                */
/* ========================================================================== */

describe("§13 — o convite", () => {
  it("troca as quatro variáveis", () => {
    const texto = renderEvaluationInvite(EVALUATION_INVITE_FALLBACK, {
      nome: "João",
      evento: "Encontro Técnico",
      dataEvento: "29/08/2026",
      link: "https://apcs.org.br/avaliacoes/abc",
    });

    expect(texto).toContain("João");
    expect(texto).toContain("Encontro Técnico");
    expect(texto).toContain("29/08/2026");
    expect(texto).toContain("https://apcs.org.br/avaliacoes/abc");
    expect(texto).not.toContain("{{");
  });

  /**
   * ⚠️ VARIÁVEL DESCONHECIDA SAI LITERAL, e isso é a decisão. Apagar o que não
   * se reconhece produziria uma frase com um buraco no meio, que parece certa e
   * não é — enquanto `{{nome_completo}}` chegando no WhatsApp é feio, óbvio e
   * corrigível em trinta segundos na tela de Textos.
   */
  it("deixa uma variável inventada como está", () => {
    const texto = renderEvaluationInvite("Olá {{nome_completo}}, {{nome}}!", {
      nome: "João",
      evento: "X",
      dataEvento: "01/01/2026",
      link: "https://x",
    });

    expect(texto).toBe("Olá {{nome_completo}}, João!");
  });

  it("o texto padrão sempre carrega o link — sem ele o convite é um beco sem saída", () => {
    expect(EVALUATION_INVITE_FALLBACK).toContain("{{link_avaliacao}}");
  });

  it("o endereço público é em português, como as outras páginas abertas", () => {
    expect(publicEvaluationPath(TOKEN)).toBe(`/avaliacoes/${TOKEN}`);
  });
});

/* ========================================================================== */
/* §24, §25 — o construtor                                                    */
/* ========================================================================== */

const BLOCO_VALIDO = {
  title: "Infraestrutura",
  description: null,
  questions: [
    {
      prompt: "Recepção durante o evento",
      type: "rating" as const,
      required: true,
      isOverall: false,
      options: [
        { label: "Excelente", value: 5 },
        { label: "Bom", value: 4 },
      ],
    },
  ],
};

describe("§24 e §25 — a estrutura das perguntas", () => {
  it("aceita um formulário completo", () => {
    expect(
      evaluationStructureSchema.safeParse({ eventId: EVENTO, sections: [BLOCO_VALIDO] }).success,
    ).toBe(true);
  });

  it("recusa avaliação sem bloco nenhum", () => {
    expect(evaluationStructureSchema.safeParse({ eventId: EVENTO, sections: [] }).success).toBe(
      false,
    );
  });

  it("recusa bloco sem título", () => {
    expect(
      evaluationStructureSchema.safeParse({
        eventId: EVENTO,
        sections: [{ ...BLOCO_VALIDO, title: "   " }],
      }).success,
    ).toBe(false);
  });

  it("recusa bloco sem pergunta", () => {
    expect(
      evaluationStructureSchema.safeParse({
        eventId: EVENTO,
        sections: [{ ...BLOCO_VALIDO, questions: [] }],
      }).success,
    ).toBe(false);
  });

  it("recusa pergunta de nota com uma alternativa só", () => {
    expect(
      evaluationStructureSchema.safeParse({
        eventId: EVENTO,
        sections: [
          {
            ...BLOCO_VALIDO,
            questions: [
              { ...BLOCO_VALIDO.questions[0]!, options: [{ label: "Excelente", value: 5 }] },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  /**
   * ⚠️ É O §5 SENDO IMPOSTO. Uma alternativa de nota sem valor entra na escala
   * sem peso, e a apuração do Prompt 3 a trataria como ausência de resposta —
   * um "Regular" sumindo da conta em silêncio.
   */
  it("recusa alternativa de nota sem valor numérico", () => {
    expect(
      evaluationStructureSchema.safeParse({
        eventId: EVENTO,
        sections: [
          {
            ...BLOCO_VALIDO,
            questions: [
              {
                ...BLOCO_VALIDO.questions[0]!,
                options: [
                  { label: "Excelente", value: null },
                  { label: "Bom", value: 4 },
                ],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("escolha única aceita alternativa sem valor — ela não vira média nenhuma", () => {
    expect(
      evaluationStructureSchema.safeParse({
        eventId: EVENTO,
        sections: [
          {
            ...BLOCO_VALIDO,
            questions: [
              {
                prompt: "Qual palestra você assistiu?",
                type: "single_choice" as const,
                required: false,
                options: [
                  { label: "Manhã", value: null },
                  { label: "Tarde", value: null },
                ],
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });

  /**
   * ⚠️ RECUSAR, E NÃO IGNORAR. Um payload que traz alternativas numa pergunta de
   * texto está confuso sobre o próprio tipo — provavelmente alguém trocou o tipo
   * e as alternativas antigas ficaram. Aceitá-lo em silêncio esconderia isso até
   * a hora de apurar.
   */
  it("texto livre não aceita alternativas", () => {
    expect(
      evaluationStructureSchema.safeParse({
        eventId: EVENTO,
        sections: [
          {
            ...BLOCO_VALIDO,
            questions: [
              {
                prompt: "Comentários",
                type: "free_text" as const,
                required: false,
                options: [{ label: "X", value: null }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("texto livre sem alternativas passa", () => {
    expect(
      evaluationStructureSchema.safeParse({
        eventId: EVENTO,
        sections: [
          {
            ...BLOCO_VALIDO,
            questions: [
              { prompt: "Comentários", type: "free_text" as const, required: false, options: [] },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });

  /**
   * ⚠️ AS ALTERNATIVAS DE SIM/NÃO SÃO GERADAS PELO BANCO (Sim = 1, Não = 0). Se
   * cada avaliação escrevesse as suas, a apuração teria de adivinhar que "Sim",
   * "sim" e "SIM" são a mesma resposta.
   */
  it("Sim/Não não recebe alternativas do formulário", () => {
    expect(
      evaluationStructureSchema.safeParse({
        eventId: EVENTO,
        sections: [
          {
            ...BLOCO_VALIDO,
            questions: [
              {
                prompt: "Almoçou no evento?",
                type: "yes_no" as const,
                required: false,
                options: [{ label: "Sim", value: 1 }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("obrigatória e opcional convivem no mesmo formulário", () => {
    const resultado = evaluationStructureSchema.safeParse({
      eventId: EVENTO,
      sections: [
        {
          ...BLOCO_VALIDO,
          questions: [
            BLOCO_VALIDO.questions[0]!,
            { prompt: "Comentários", type: "free_text" as const, required: false, options: [] },
          ],
        },
      ],
    });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.sections[0]!.questions[0]!.required).toBe(true);
      expect(resultado.data.sections[0]!.questions[1]!.required).toBe(false);
    }
  });

  /**
   * ⚠️ NENHUM `position` VIAJA NO PAYLOAD. Quem numera é o banco, com
   * `ordinality` sobre o array recebido — a ORDEM do array é a ordem do
   * formulário. Mandar a posição daqui criaria uma segunda fonte para ela, e as
   * duas divergiriam no primeiro clique na seta de reordenar.
   */
  it("a action manda os blocos sem posição — a ordem do array é a ordem", async () => {
    await saveEvaluationStructureAction({ eventId: EVENTO, sections: [BLOCO_VALIDO] });

    const enviados = argumentos(rpc).p_sections as unknown[];
    expect(JSON.stringify(enviados)).not.toContain("position");
  });

  it("os cinco tipos do §4 estão declarados, e só eles", () => {
    expect([...EVALUATION_QUESTION_TYPES].sort()).toEqual([
      "free_text",
      "multiple_choice",
      "rating",
      "single_choice",
      "yes_no",
    ]);
  });

  it("múltipla escolha é o único tipo que aceita mais de uma resposta", () => {
    expect(SINGLE_ANSWER_TYPES).not.toContain("multiple_choice");
    expect(SINGLE_ANSWER_TYPES).toContain("rating");
    expect(SINGLE_ANSWER_TYPES).toContain("single_choice");
    expect(SINGLE_ANSWER_TYPES).toContain("yes_no");
  });
});

/* ========================================================================== */
/* §28 — IDOR                                                                 */
/* ========================================================================== */

describe("§28 — o evento viaja junto, sempre", () => {
  it("reenviar manda o evento e a avaliação", async () => {
    rpc.mockResolvedValue({ data: { id: AVALIACAO, status: "scheduled" }, error: null });

    await resendEvaluationAction({ eventId: EVENTO, participantEvaluationId: AVALIACAO });

    expect(argumentos(rpc)).toEqual({
      p_event_id: EVENTO,
      p_participant_evaluation_id: AVALIACAO,
    });
  });

  it("o schema recusa a ação sem o evento", () => {
    expect(
      evaluationParticipantActionSchema.safeParse({ participantEvaluationId: AVALIACAO }).success,
    ).toBe(false);
  });

  /**
   * ⚠️ O EVENTO ERRADO NÃO É RECUSADO AQUI — é recusado NO BANCO, e é ali que
   * tem de ser. Este caso prova que o par chega inteiro para a função conferir a
   * cadeia; sem ele, um id de avaliação de outro evento passaria sem que nada
   * tivesse com o que comparar.
   */
  it("um evento diferente continua sendo enviado para o banco decidir", async () => {
    rpc.mockResolvedValue({ data: { id: AVALIACAO, status: "scheduled" }, error: null });

    await resendEvaluationAction({
      eventId: OUTRO_EVENTO,
      participantEvaluationId: AVALIACAO,
    });

    expect(argumentos(rpc).p_event_id).toBe(OUTRO_EVENTO);
  });

  it("P0002 do banco vira 'não encontrado', sem distinguir 'não existe' de 'é de outro'", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0002", message: "Avaliação não encontrada." },
    });

    const resultado = await resendEvaluationAction({
      eventId: EVENTO,
      participantEvaluationId: AVALIACAO,
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("notFound");
  });
});

/* ========================================================================== */
/* §17, §18, §19 — reenvio, resposta única e reabertura                       */
/* ========================================================================== */

describe("§17 e §18 — reenviar não cria resposta", () => {
  it("reenviar é uma chamada só, e não mexe em resposta nenhuma", async () => {
    rpc.mockResolvedValue({ data: { id: AVALIACAO, status: "scheduled" }, error: null });

    await resendEvaluationAction({ eventId: EVENTO, participantEvaluationId: AVALIACAO });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("resend_event_evaluation");
    // Nada de resposta, de pergunta ou de token no payload.
    expect(Object.keys(argumentos(rpc))).toEqual(["p_event_id", "p_participant_evaluation_id"]);
  });

  it("AV004 do banco vira 'já respondida' — §17: quem respondeu não recebe de novo", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "AV004", message: "já respondida" } });

    const resultado = await resendEvaluationAction({
      eventId: EVENTO,
      participantEvaluationId: AVALIACAO,
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("evaluationAlreadyAnswered");
  });

  it("AV005 vira 'expirada' — reenviar um link morto não é reenviar", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "AV005", message: "prazo" } });

    const resultado = await resendEvaluationAction({
      eventId: EVENTO,
      participantEvaluationId: AVALIACAO,
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("evaluationExpired");
  });

  it("cancelar chama a função de cancelar", async () => {
    rpc.mockResolvedValue({ data: { id: AVALIACAO, status: "cancelled" }, error: null });

    await cancelEvaluationAction({ eventId: EVENTO, participantEvaluationId: AVALIACAO });

    expect(rpc.mock.calls[0]?.[0]).toBe("cancel_event_evaluation");
  });

  it("reabrir chama a função de reabrir (§19)", async () => {
    rpc.mockResolvedValue({ data: { id: AVALIACAO, status: "sent" }, error: null });

    await reopenEvaluationAction({ eventId: EVENTO, participantEvaluationId: AVALIACAO });

    expect(rpc.mock.calls[0]?.[0]).toBe("reopen_event_evaluation");
  });
});

/* ========================================================================== */
/* §35 — RBAC                                                                 */
/* ========================================================================== */

describe("§35 — quem pode o quê", () => {
  it("a matriz: ler é do Administrador e do Atendente", () => {
    expect(hasPermission("admin", "evaluations.read")).toBe(true);
    expect(hasPermission("comercial", "evaluations.read")).toBe(true);
    expect(hasPermission("viewer", "evaluations.read")).toBe(false);
    expect(hasPermission("financeiro", "evaluations.read")).toBe(false);
  });

  /**
   * ⚠️ A CAIXA DO MEIO É A MAIS ESTREITA, e é a única assimetria deste tipo no
   * sistema. Reescrever a pergunta muda o que a APCS está perguntando — e, com
   * respostas coletadas, muda o significado do histórico.
   */
  it("editar perguntas é SÓ do Administrador", () => {
    expect(hasPermission("admin", "evaluations.write")).toBe(true);
    expect(hasPermission("comercial", "evaluations.write")).toBe(false);
  });

  it("reenviar alcança o Atendente — quem opera o evento é quem descobre a falha", () => {
    expect(hasPermission("admin", "evaluations.send")).toBe(true);
    expect(hasPermission("comercial", "evaluations.send")).toBe(true);
    expect(hasPermission("viewer", "evaluations.send")).toBe(false);
  });

  it("o Atendente não configura: a action recusa antes de tocar no banco", async () => {
    papelAtual = "comercial";

    const resultado = await saveEvaluationSettingsAction({
      eventId: EVENTO,
      enabled: true,
      delayMinutes: 30,
      responseWindowDays: null,
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("forbidden");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("o Atendente reenvia", async () => {
    papelAtual = "comercial";
    rpc.mockResolvedValue({ data: { id: AVALIACAO, status: "scheduled" }, error: null });

    const resultado = await resendEvaluationAction({
      eventId: EVENTO,
      participantEvaluationId: AVALIACAO,
    });

    expect(resultado.ok).toBe(true);
  });

  /**
   * ⚠️ REABRIR PEDE `write`, E NÃO `send`. Reenviar é operação; reabrir MEXE NO
   * DADO JÁ COLETADO, e quem responde pelo que a APCS vai concluir da pesquisa é
   * quem configura a pesquisa.
   */
  it("o Atendente NÃO reabre uma avaliação respondida", async () => {
    papelAtual = "comercial";

    const resultado = await reopenEvaluationAction({
      eventId: EVENTO,
      participantEvaluationId: AVALIACAO,
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("forbidden");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sem sessão, nada passa", async () => {
    papelAtual = null;

    const resultado = await saveEvaluationStructureAction({
      eventId: EVENTO,
      sections: [BLOCO_VALIDO],
    });

    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("trocar o modelo é `write` — ele destrói perguntas escritas à mão", async () => {
    papelAtual = "comercial";

    const resultado = await applyEvaluationTemplateAction({
      eventId: EVENTO,
      templateId: MODELO,
    });

    expect(resultado.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

/* ========================================================================== */
/* §29, §30, §32 — a porta pública                                            */
/* ========================================================================== */

describe("§30 e §32 — a resposta pública", () => {
  it("manda o token e as respostas, e nada mais", async () => {
    await submitPublicEvaluationAction({
      token: TOKEN,
      answers: [{ questionId: PERGUNTA, optionIds: [OPCAO], text: null }],
    });

    expect(rpcAdmin.mock.calls[0]?.[0]).toBe("submit_event_evaluation");
    expect(Object.keys(argumentos(rpcAdmin))).toEqual(["p_token", "p_answers"]);
  });

  /**
   * ⚠️ O VALOR DA NOTA NÃO EXISTE NO PAYLOAD (§32). O navegador manda QUAL
   * alternativa foi marcada; quanto ela vale é o banco quem diz, copiando de
   * `numeric_value`. Esta página é pública — aceitar o número de fora deixaria
   * qualquer pessoa mandar "10" numa escala de 5 e envenenar a média.
   */
  it("o payload não tem campo de valor numérico", () => {
    const resultado = publicEvaluationSubmissionSchema.safeParse({
      token: TOKEN,
      answers: [{ questionId: PERGUNTA, optionIds: [OPCAO], text: null, value: 10 }],
    });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(JSON.stringify(resultado.data)).not.toContain("10");
    }
  });

  /**
   * ⚠️ E NÃO TEM `participantId` (§29). Quem responde é definido pelo TOKEN, e
   * só por ele — um id de participante no corpo seria um convite a responder no
   * lugar de outra pessoa.
   */
  it("o payload não carrega identificação do participante", () => {
    const resultado = publicEvaluationSubmissionSchema.safeParse({
      token: TOKEN,
      answers: [{ questionId: PERGUNTA, optionIds: [], text: "tudo ótimo" }],
    });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(Object.keys(resultado.data)).toEqual(["token", "answers"]);
    }
  });

  it("recusa token vazio, curto ou fora do formato", () => {
    for (const ruim of ["", "abc", "z".repeat(32), `${TOKEN}!`]) {
      expect(
        publicEvaluationSubmissionSchema.safeParse({ token: ruim, answers: [] }).success,
        `o token "${ruim.slice(0, 8)}" deveria ser recusado`,
      ).toBe(false);
    }
  });

  it("AV004 do banco vira a frase de agradecimento, e não um erro seco", async () => {
    rpcAdmin.mockResolvedValue({ data: null, error: { code: "AV004", message: "já respondida" } });

    const resultado = await submitPublicEvaluationAction({
      token: TOKEN,
      answers: [{ questionId: PERGUNTA, optionIds: [OPCAO], text: null }],
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("evaluationAlreadyAnswered");
  });

  it("AV005 vira 'expirada' (§20)", async () => {
    rpcAdmin.mockResolvedValue({ data: null, error: { code: "AV005", message: "prazo" } });

    const resultado = await submitPublicEvaluationAction({
      token: TOKEN,
      answers: [],
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("evaluationExpired");
  });

  it("AV006 vira 'falta responder obrigatória' (§25)", async () => {
    rpcAdmin.mockResolvedValue({
      data: null,
      error: { code: "AV006", message: "Falta responder: X" },
    });

    const resultado = await submitPublicEvaluationAction({ token: TOKEN, answers: [] });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("evaluationMissingRequired");
  });

  it("AV007 vira a frase neutra — é a mesma de token inexistente (§33)", async () => {
    rpcAdmin.mockResolvedValue({ data: null, error: { code: "AV007", message: "indisponível" } });

    const resultado = await submitPublicEvaluationAction({ token: TOKEN, answers: [] });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error.code).toBe("evaluationUnavailable");
  });

  it("múltipla escolha manda várias opções na mesma pergunta", () => {
    const outra = "88888888-8888-4888-8888-888888888888";
    const resultado = publicEvaluationSubmissionSchema.safeParse({
      token: TOKEN,
      answers: [{ questionId: PERGUNTA, optionIds: [OPCAO, outra], text: null }],
    });

    expect(resultado.success).toBe(true);
    if (resultado.success) expect(resultado.data.answers[0]!.optionIds).toHaveLength(2);
  });

  it("o comentário viaja como texto, sem alternativa (§26)", () => {
    const resultado = publicEvaluationSubmissionSchema.safeParse({
      token: TOKEN,
      answers: [{ questionId: PERGUNTA, optionIds: [], text: "Traga mais sobre sanidade." }],
    });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.answers[0]!.text).toBe("Traga mais sobre sanidade.");
      expect(resultado.data.answers[0]!.optionIds).toEqual([]);
    }
  });
});

/* ========================================================================== */
/* A URL — busca, filtro e paginação                                          */
/* ========================================================================== */

describe("os filtros na URL", () => {
  it("os padrões não aparecem no endereço", () => {
    expect(eventEvaluationHref(EVENTO, EMPTY_EVALUATION_FILTERS)).toBe(
      `/events/evaluations/${EVENTO}`,
    );
    expect(evaluationsHref()).toBe("/events/evaluations");
  });

  it("busca, situação e página fazem a volta completa", () => {
    const filtros = { query: "granja", status: "answered" as const, page: 3 };
    const endereco = eventEvaluationHref(EVENTO, filtros);
    const lido = parseEvaluationFilters(
      Object.fromEntries(new URL(`https://x${endereco}`).searchParams),
    );

    expect(lido).toEqual(filtros);
  });

  /**
   * ⚠️ VALOR DESCONHECIDO CAI NO PADRÃO, e não derruba a tela nem devolve lista
   * vazia. Uma URL colada errada não deve parecer "ninguém esteve presente neste
   * evento".
   */
  it("uma situação inventada vira 'todas'", () => {
    expect(parseEvaluationFilters({ st: "inventado" }).status).toBe("all");
  });

  it("página inválida vira 1", () => {
    expect(parseEvaluationFilters({ page: "-4" }).page).toBe(1);
    expect(parseEvaluationFilters({ page: "abc" }).page).toBe(1);
  });

  /**
   * ⚠️ `not_created` NÃO É UM VALOR DO ENUM DO BANCO, e é o filtro mais útil da
   * tela: são os presentes para quem a rotina ainda não criou nada.
   */
  it("'ainda não gerada' é um filtro válido", () => {
    expect(parseEvaluationFilters({ st: "not_created" }).status).toBe("not_created");
  });

  it("sabe quando há filtro ativo", () => {
    expect(hasActiveEvaluationFilters(EMPTY_EVALUATION_FILTERS)).toBe(false);
    expect(hasActiveEvaluationFilters({ ...EMPTY_EVALUATION_FILTERS, query: "x" })).toBe(true);
    expect(hasActiveEvaluationFilters({ ...EMPTY_EVALUATION_FILTERS, status: "sent" })).toBe(true);
    // Página não é filtro: estar na página 2 não é ter filtrado nada.
    expect(hasActiveEvaluationFilters({ ...EMPTY_EVALUATION_FILTERS, page: 2 })).toBe(false);
  });
});
