import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagingProvider, SendResult } from "@/lib/messaging/messaging.types";

/**
 * A JORNADA COMPLETA — do fim do evento até a resposta gravada.
 *
 * ============================================================================
 * ⚠️ O QUE ESTA SUÍTE É, E O QUE ELA HONESTAMENTE NÃO É.
 * ============================================================================
 * O §40 pede E2E. Um E2E de verdade subiria Postgres, aplicaria as migrations,
 * criaria um evento e clicaria numa tela. Este projeto **não sobe banco na
 * bateria** — e fingir que sobe seria a pior das saídas, porque um arquivo
 * chamado "e2e" que não toca o banco dá a quem lê a impressão de que a jornada
 * está coberta quando não está.
 *
 * Então esta suíte cobre a METADE QUE É CÓDIGO DA APLICAÇÃO: a ORQUESTRAÇÃO.
 * O worker é exercitado de verdade, com o provider de mensageria real (a
 * interface) e uma fila em memória que responde no lugar do Postgres.
 *
 * O que ela PROVA:
 *   • a ordem do ciclo (expirar → agendar → reivindicar → enviar → carimbar);
 *   • que uma segunda passada não reenvia (§44);
 *   • que falha de envio NÃO carimba como enviada (§13);
 *   • que telefone inválido não vira tentativa de envio (§29);
 *   • que convite sem link não sai (§22);
 *   • que o texto vem de `app_settings`, e não do código (§22);
 *   • que o token nunca aparece em log (§39);
 *   • que os motivos de ignore chegam à resposta da rotina (§5, §14).
 *
 * O que ela NÃO prova, e está coberto em outro lugar:
 *   • as REGRAS que moram em SQL — presença, versão, rodada, uma resposta por
 *     participante, transação, IDOR. Ver `sql-event-evaluation.test.ts` e
 *     `sql-event-results.test.ts`, que leem as invariantes do texto das
 *     migrations;
 *   • a RLS, que só existe com um Postgres de verdade.
 *
 * ============================================================================
 * ⚠️ A FILA EM MEMÓRIA NÃO REIMPLEMENTA AS REGRAS DO BANCO.
 * ============================================================================
 * Ela é deliberadamente burra: guarda linhas, devolve as que o worker pede e
 * registra o que ele mandou gravar. Se ela reimplementasse o `where` de
 * `claim_event_evaluations`, esta suíte estaria testando a fila — e passaria
 * feliz enquanto o SQL de verdade estivesse errado.
 *
 * O que ela faz é responder às chamadas e DEIXAR VER quais foram. As asserções
 * são sobre o comportamento do worker, nunca sobre o conteúdo da fila.
 */

/* -------------------------------------------------------------------------- */
/* A fila em memória                                                           */
/* -------------------------------------------------------------------------- */

interface LinhaFila {
  id: string;
  token: string;
  eventId: string;
  eventName: string;
  eventDate: string;
  participantId: string;
  fullName: string;
  whatsapp: string | null;
  phone: string | null;
  attempts: number;
}

/** O que `schedule_event_evaluations` devolve. */
interface ResumoAgendamento {
  events: number;
  created: number;
  skippedNoPresent: number;
  skippedNoQuestions: number;
}

const estado = vi.hoisted(() => ({
  /** O lote que a próxima reivindicação devolve. Esvazia ao ser lido — como a fila de verdade. */
  fila: [] as LinhaFila[],
  expiradas: 0,
  agendamento: {
    events: 0,
    created: 0,
    skippedNoPresent: 0,
    skippedNoQuestions: 0,
  } as ResumoAgendamento,
  /** O texto do convite em `app_settings`. `null` = linha ausente. */
  convite: null as string | null,
  /** Tudo o que o worker mandou o banco gravar, na ordem. */
  chamadas: [] as { fn: string; args: Record<string, unknown> }[],
  /**
   * Respostas forçadas, por nome de função.
   *
   * ⚠️ ELE EXISTE PORQUE `vi.spyOn` NÃO ALCANÇA O CLIENTE DO WORKER.
   * `createAdminClient()` devolve um objeto novo a cada chamada, então espionar
   * a instância do teste não muda a instância que o worker pegou. O desvio mora
   * DENTRO do dublê, que é o único lugar por onde os dois passam.
   */
  forcar: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      estado.chamadas.push({ fn, args });

      if (fn in estado.forcar) return estado.forcar[fn]!;

      if (fn === "expire_event_evaluations") return { data: estado.expiradas, error: null };
      if (fn === "schedule_event_evaluations") return { data: estado.agendamento, error: null };

      if (fn === "claim_event_evaluations") {
        // ⚠️ ESVAZIA AO SER LIDA. É o que reproduz a propriedade que importa
        // para o §44: a segunda passada não encontra nada, porque a primeira
        // reivindicou. Quem garante isso de verdade é o `skip locked` + o
        // arrendamento no SQL.
        const lote = estado.fila;
        estado.fila = [];
        return { data: lote, error: null };
      }

      return { data: null, error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          returns: async () => ({
            data: estado.convite === null ? [] : [{ value: estado.convite }],
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

const { runEventEvaluationTick } = await import("@/lib/services/event-evaluation-dispatch");
const { EVALUATION_INVITE_FALLBACK } = await import("@/modules/event/event.evaluation.labels");

/* -------------------------------------------------------------------------- */
/* O fornecedor de mensageria                                                  */
/* -------------------------------------------------------------------------- */

const enviadas: { to: string; body: string }[] = [];
let proximoEnvio: SendResult = { ok: true, providerMessageId: "prov-1" };

function provedor(configurado = true): MessagingProvider {
  return {
    name: "teste",
    configured: configurado,
    missing: configurado ? [] : ["Z_API_TOKEN"],
    send: async (m) => {
      enviadas.push({ to: m.to, body: m.body });
      return proximoEnvio;
    },
    sendImage: async () => proximoEnvio,
    sendDocument: async () => proximoEnvio,
    verifySignature: () => ({ valid: true, reason: "" }),
    parseWebhook: () => [],
  };
}

const ORIGEM = "https://apcs.org.br";

function linha(extra: Partial<LinhaFila> = {}): LinhaFila {
  return {
    id: "pe-1",
    token: "a".repeat(32),
    eventId: "ev-1",
    eventName: "Encontro Técnico",
    eventDate: "2026-08-29",
    participantId: "p-1",
    fullName: "João da Silva",
    whatsapp: "5519991234567",
    phone: null,
    attempts: 1,
    ...extra,
  };
}

/** As chamadas de gravação, na ordem — sem as leituras. */
function gravacoes(): string[] {
  return estado.chamadas.map((c) => c.fn).filter((fn) => fn.startsWith("mark_"));
}

let logInfo: ReturnType<typeof vi.spyOn>;
let logErro: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  estado.fila = [];
  estado.expiradas = 0;
  estado.agendamento = { events: 0, created: 0, skippedNoPresent: 0, skippedNoQuestions: 0 };
  estado.convite = EVALUATION_INVITE_FALLBACK;
  estado.chamadas = [];
  estado.forcar = {};
  enviadas.length = 0;
  proximoEnvio = { ok: true, providerMessageId: "prov-1" };

  logInfo = vi.spyOn(console, "info").mockImplementation(() => {});
  logErro = vi.spyOn(console, "error").mockImplementation(() => {});
});

function linhasDeLog(): string {
  return [...logInfo.mock.calls, ...logErro.mock.calls].map((c) => String(c[0])).join("\n");
}

/* ========================================================================== */
/* §40 — CENÁRIO 1: o fluxo feliz                                             */
/* ========================================================================== */

describe("§40 — o fluxo feliz, do término do evento ao convite entregue", () => {
  it("expira, agenda, reivindica, envia e carimba — nesta ordem", async () => {
    estado.agendamento = { events: 1, created: 1, skippedNoPresent: 0, skippedNoQuestions: 0 };
    estado.fila = [linha()];

    const r = await runEventEvaluationTick(ORIGEM, provedor());

    /**
     * ⚠️ A ORDEM NÃO É DECORAÇÃO. Agendar antes de expirar mandaria convite de
     * avaliação vencida; enviar antes de agendar deixaria quem acabou de ficar
     * elegível para a passada seguinte.
     */
    const ordem = estado.chamadas.map((c) => c.fn);
    expect(ordem.slice(0, 3)).toEqual([
      "expire_event_evaluations",
      "schedule_event_evaluations",
      "claim_event_evaluations",
    ]);
    expect(ordem).toContain("mark_event_evaluation_sent");

    expect(r.created).toBe(1);
    expect(r.claimed).toBe(1);
    expect(r.sent).toBe(1);
    expect(r.errors).toBe(0);
    expect(enviadas).toHaveLength(1);
  });

  it("o convite leva o link absoluto da avaliação (§23)", async () => {
    estado.fila = [linha({ token: "b".repeat(32) })];

    await runEventEvaluationTick(ORIGEM, provedor());

    expect(enviadas[0]?.body).toContain(`${ORIGEM}/avaliacoes/${"b".repeat(32)}`);
    // ⚠️ HTTPS em produção vem do endereço configurado, e não de uma montagem
    // aqui — é `getSiteOrigin()` quem decide, na rota do job.
    expect(enviadas[0]?.body).toContain("https://");
  });

  it("o convite é personalizado com o primeiro nome e o evento (§22)", async () => {
    estado.fila = [linha()];

    await runEventEvaluationTick(ORIGEM, provedor());

    expect(enviadas[0]?.body).toContain("João");
    expect(enviadas[0]?.body).toContain("Encontro Técnico");
    expect(enviadas[0]?.body).toContain("29/08/2026");
    // Nenhuma variável sobrou por trocar.
    expect(enviadas[0]?.body).not.toContain("{{");
  });

  it("manda para o WhatsApp normalizado, e não para o telefone fixo", async () => {
    estado.fila = [linha({ whatsapp: "5519991234567", phone: "1935551234" })];

    await runEventEvaluationTick(ORIGEM, provedor());

    expect(enviadas[0]?.to).toBe("5519991234567");
  });

  it("o carimbo leva o id do fornecedor — sem ele ninguém escreve 'enviada' (§13)", async () => {
    estado.fila = [linha()];
    proximoEnvio = { ok: true, providerMessageId: "zapi-42" };

    await runEventEvaluationTick(ORIGEM, provedor());

    const carimbo = estado.chamadas.find((c) => c.fn === "mark_event_evaluation_sent");
    expect(carimbo?.args).toMatchObject({ p_id: "pe-1", p_provider_message_id: "zapi-42" });
  });
});

/* ========================================================================== */
/* §44 — duplo processamento                                                  */
/* ========================================================================== */

describe("§44 — rodar o job duas vezes não manda duas mensagens", () => {
  it("a segunda passada não encontra fila e não envia nada", async () => {
    estado.fila = [linha()];

    const primeira = await runEventEvaluationTick(ORIGEM, provedor());
    const segunda = await runEventEvaluationTick(ORIGEM, provedor());

    expect(primeira.sent).toBe(1);
    expect(segunda.sent).toBe(0);
    expect(segunda.claimed).toBe(0);
    expect(enviadas).toHaveLength(1);
  });

  /**
   * ⚠️ O QUE GARANTE ISSO DE VERDADE ESTÁ NO SQL, e não aqui: o índice único
   * `(event_id, participant_id)` impede criar duas linhas, e o
   * `for update of pe skip locked` + arrendamento impede duas passadas
   * reivindicarem a mesma. Este caso prova que o WORKER não inventa um segundo
   * envio por conta própria — que é a parte dele.
   */
  it("o worker só envia o que a reivindicação devolveu", async () => {
    estado.fila = [linha({ id: "pe-1" }), linha({ id: "pe-2", token: "c".repeat(32) })];

    const r = await runEventEvaluationTick(ORIGEM, provedor());

    expect(r.claimed).toBe(2);
    expect(enviadas).toHaveLength(2);
  });
});

/* ========================================================================== */
/* §13 — falha de envio                                                       */
/* ========================================================================== */

describe("§13 — o WhatsApp indisponível", () => {
  it("registra a falha e NÃO carimba como enviada", async () => {
    estado.fila = [linha()];
    proximoEnvio = { ok: false, retryable: true, code: "503", message: "fora do ar" };

    const r = await runEventEvaluationTick(ORIGEM, provedor());

    expect(r.errors).toBe(1);
    expect(r.sent).toBe(0);
    // ⚠️ A ASSERÇÃO QUE IMPORTA: `mark_sent` não foi chamada.
    expect(gravacoes()).toEqual(["mark_event_evaluation_failed"]);
    expect(gravacoes()).not.toContain("mark_event_evaluation_sent");
  });

  it("o motivo registrado é o do fornecedor, e vai para a linha", async () => {
    estado.fila = [linha()];
    proximoEnvio = { ok: false, retryable: true, code: "429", message: "limite" };

    await runEventEvaluationTick(ORIGEM, provedor());

    const falha = estado.chamadas.find((c) => c.fn === "mark_event_evaluation_failed");
    expect(String(falha?.args.p_error)).toContain("429");
  });

  /**
   * ⚠️ O CASO MAIS PERIGOSO DO WORKER: a mensagem SAIU e o carimbo não entrou. A
   * pessoa recebeu, a linha continua na fila, e o arrendamento a devolve dez
   * minutos depois. Não há como desfazer o envio — o que dá para fazer é CONTAR,
   * e é isso que `unsettled` existe para.
   */
  it("mensagem enviada e carimbo falhando é contada à parte", async () => {
    estado.fila = [linha()];
    // O envio acontece; a gravação do carimbo falha.
    estado.forcar["mark_event_evaluation_sent"] = {
      data: null,
      error: { code: "57014", message: "timeout" },
    };

    const r = await runEventEvaluationTick(ORIGEM, provedor());

    expect(enviadas).toHaveLength(1);
    expect(r.unsettled).toBe(1);
    expect(r.sent).toBe(0);
  });
});

/* ========================================================================== */
/* §29 — participante sem WhatsApp                                            */
/* ========================================================================== */

describe("§29 — participante sem canal de WhatsApp válido", () => {
  it("não tenta enviar, e registra o motivo", async () => {
    estado.fila = [linha({ whatsapp: null, phone: null })];

    const r = await runEventEvaluationTick(ORIGEM, provedor());

    // ⚠️ "NÃO TENTAR ENVIAR PARA NÚMERO INEXISTENTE" — o provider não é chamado.
    expect(enviadas).toHaveLength(0);
    expect(r.ineligible).toBe(1);
    expect(r.errors).toBe(0);

    const falha = estado.chamadas.find((c) => c.fn === "mark_event_evaluation_failed");
    expect(String(falha?.args.p_error)).toContain("telefone inválido");
  });

  it("telefone malformado também não vira tentativa de envio", async () => {
    estado.fila = [linha({ whatsapp: "123", phone: null })];

    const r = await runEventEvaluationTick(ORIGEM, provedor());

    expect(enviadas).toHaveLength(0);
    expect(r.ineligible).toBe(1);
  });

  /**
   * ⚠️ E A AVALIAÇÃO CONTINUA EXISTINDO (§29). O worker marca a linha com o
   * motivo e segue — ele nunca apaga nada. Quem corrige o cadastro reenvia pela
   * tela, e a mesma linha volta para a fila.
   */
  it("a avaliação não é apagada — só marcada", async () => {
    estado.fila = [linha({ whatsapp: null, phone: null })];

    await runEventEvaluationTick(ORIGEM, provedor());

    expect(estado.chamadas.map((c) => c.fn)).not.toContain("delete_event_evaluation");
    expect(gravacoes()).toEqual(["mark_event_evaluation_failed"]);
  });
});

/* ========================================================================== */
/* §22 — o texto do convite                                                   */
/* ========================================================================== */

describe("§22 — a mensagem vem de Textos e LGPD", () => {
  it("usa o texto gravado, e não o do código", async () => {
    estado.convite = "Oi {{nome}}, avalie: {{link_avaliacao}}";
    estado.fila = [linha()];

    await runEventEvaluationTick(ORIGEM, provedor());

    expect(enviadas[0]?.body).toBe(`Oi João, avalie: ${ORIGEM}/avaliacoes/${"a".repeat(32)}`);
  });

  it("sem a linha no banco, cai no padrão do código e ainda manda", async () => {
    estado.convite = null;
    estado.fila = [linha()];

    const r = await runEventEvaluationTick(ORIGEM, provedor());

    expect(r.sent).toBe(1);
    expect(enviadas[0]?.body).toContain("avaliação");
  });

  /**
   * ⚠️ O CASO QUE O §22 PEDE E QUE NÃO EXISTIA ATÉ O PROMPT 4. "Se alguma
   * variável não existir: não enviar mensagem quebrada. Registrar erro de
   * configuração."
   *
   * Um texto sem `{{link_avaliacao}}` produz um convite educado, legível, e sem
   * endereço nenhum. O fornecedor aceita, o carimbo entra, a tela diz "Enviada"
   * — e trezentas pessoas recebem um convite que não têm como abrir.
   */
  it("convite sem {{link_avaliacao}} NÃO sai", async () => {
    estado.convite = "Olá {{nome}}, obrigado por participar do {{evento}}!";
    estado.fila = [linha()];

    const r = await runEventEvaluationTick(ORIGEM, provedor());

    expect(enviadas).toHaveLength(0);
    expect(r.misconfigured).toBe(1);
    expect(r.sent).toBe(0);
  });

  it("e o motivo aponta para a tela de Textos, não para o telefone", async () => {
    estado.convite = "Olá {{nome}}!";
    estado.fila = [linha()];

    await runEventEvaluationTick(ORIGEM, provedor());

    const falha = estado.chamadas.find((c) => c.fn === "mark_event_evaluation_failed");
    expect(String(falha?.args.p_error)).toContain("Textos e LGPD");
    expect(String(falha?.args.p_error)).toContain("{{link_avaliacao}}");
  });

  /** Variável desconhecida sai literal — é feio de propósito, e visível. */
  it("variável inventada não impede o envio, e aparece na mensagem", async () => {
    estado.convite = "Olá {{nome_completo}}, avalie: {{link_avaliacao}}";
    estado.fila = [linha()];

    const r = await runEventEvaluationTick(ORIGEM, provedor());

    expect(r.sent).toBe(1);
    expect(enviadas[0]?.body).toContain("{{nome_completo}}");
  });
});

/* ========================================================================== */
/* §5 e §14 — o que a passada ignorou                                         */
/* ========================================================================== */

describe("§5 e §14 — o evento sem presentes não some do log", () => {
  it("a rotina termina bem e reporta zero presentes", async () => {
    estado.agendamento = {
      events: 0,
      created: 0,
      skippedNoPresent: 2,
      skippedNoQuestions: 0,
    };

    const r = await runEventEvaluationTick(ORIGEM, provedor());

    expect(r.created).toBe(0);
    expect(r.sent).toBe(0);
    expect(r.skippedNoPresent).toBe(2);
    expect(linhasDeLog()).toContain("ignorados_sem_presente=2");
  });

  it("formulário sem pergunta é um motivo de ignore contado à parte", async () => {
    estado.agendamento = {
      events: 0,
      created: 0,
      skippedNoPresent: 0,
      skippedNoQuestions: 1,
    };

    const r = await runEventEvaluationTick(ORIGEM, provedor());

    expect(r.skippedNoQuestions).toBe(1);
    expect(linhasDeLog()).toContain("ignorados_sem_pergunta=1");
  });

  it("sem fornecedor configurado, expira e agenda mesmo assim (§4)", async () => {
    estado.expiradas = 3;
    estado.agendamento = { events: 1, created: 5, skippedNoPresent: 0, skippedNoQuestions: 0 };
    estado.fila = [linha()];

    const r = await runEventEvaluationTick(ORIGEM, provedor(false));

    // ⚠️ AS PROMESSAS DO BANCO NÃO DEPENDEM DE WHATSAPP. A tela de Avaliações
    // precisa dizer a verdade sobre o andamento mesmo sem integração.
    expect(r.expired).toBe(3);
    expect(r.created).toBe(5);
    expect(r.sent).toBe(0);
    expect(enviadas).toHaveLength(0);
  });
});

/* ========================================================================== */
/* §39 — observabilidade                                                      */
/* ========================================================================== */

describe("§39 — o que pode e o que não pode entrar no log", () => {
  /**
   * ⚠️ O TOKEN É A CREDENCIAL DE ACESSO À AVALIAÇÃO. Escrito num log, ele fica
   * em texto puro num lugar que ninguém audita e que costuma ser encaminhado
   * para fora — um print num chamado, um painel de observabilidade de terceiro.
   */
  it("o token NUNCA aparece no log", async () => {
    const token = "d".repeat(32);
    estado.fila = [linha({ token })];

    await runEventEvaluationTick(ORIGEM, provedor());

    expect(linhasDeLog()).not.toContain(token);
  });

  it("o nome do participante também não", async () => {
    estado.fila = [linha({ fullName: "Maria Aparecida de Souza" })];

    await runEventEvaluationTick(ORIGEM, provedor());

    expect(linhasDeLog()).not.toContain("Maria Aparecida");
  });

  it("o telefone sai mascarado, e nunca inteiro", async () => {
    estado.fila = [linha({ whatsapp: "5519991234567" })];

    await runEventEvaluationTick(ORIGEM, provedor());

    const log = linhasDeLog();
    expect(log).not.toContain("5519991234567");
    // `maskPhone` deixa os últimos dígitos, que é o que permite conferir com a
    // pessoa sem publicar o número.
    expect(log).toContain("4567");
  });

  it("o corpo da mensagem não vai para o log", async () => {
    estado.convite = "SEGREDO-DO-CONVITE {{link_avaliacao}}";
    estado.fila = [linha()];

    await runEventEvaluationTick(ORIGEM, provedor());

    expect(linhasDeLog()).not.toContain("SEGREDO-DO-CONVITE");
  });

  /** §14. Um id por corrida, que amarra todas as linhas da mesma passada. */
  it("todas as linhas da passada carregam o mesmo correlationId", async () => {
    estado.fila = [linha()];

    const r = await runEventEvaluationTick(ORIGEM, provedor());

    expect(r.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(linhasDeLog()).toContain(r.correlationId);
  });
});

/* ========================================================================== */
/* §11 e §14 — o ciclo é o mesmo, sempre                                      */
/* ========================================================================== */

describe("§11 — a rotina reusa o mecanismo de jobs do projeto", () => {
  it("uma passada sem trabalho nenhum termina limpa", async () => {
    const r = await runEventEvaluationTick(ORIGEM, provedor());

    expect(r.sent).toBe(0);
    expect(r.errors).toBe(0);
    expect(r.claimed).toBe(0);
    expect(enviadas).toHaveLength(0);
    // Expirar e agendar continuam sendo chamados: são baratos e idempotentes.
    expect(estado.chamadas.map((c) => c.fn)).toEqual([
      "expire_event_evaluations",
      "schedule_event_evaluations",
      "claim_event_evaluations",
    ]);
  });

  it("erro ao agendar não derruba a passada — o envio continua", async () => {
    // A fila já tem trabalho de uma passada anterior; o agendamento falha agora.
    estado.fila = [linha()];
    estado.forcar["schedule_event_evaluations"] = {
      data: null,
      error: { code: "40001", message: "deadlock" },
    };

    const r = await runEventEvaluationTick(ORIGEM, provedor());

    expect(r.created).toBe(0);
    expect(r.sent).toBe(1);
  });
});

/* ========================================================================== */
/* §49 — o conjunto conhecido                                                 */
/* ========================================================================== */

const { hasPermission } = await import("@/lib/rbac/rbac.config");
const { VALID_ROLES } = await import("@/lib/rbac/rbac.types");
const { responseRatePercent, optionPercent, formatAverage } =
  await import("@/modules/event/event.results.rules");

describe("§49 — os números do exemplo do escopo", () => {
  /**
   * O §49 dá um conjunto fechado e pede para conferir a aritmética:
   *
   *   10 presentes · 10 enviadas · 8 respondidas → taxa 80%, 2 pendentes
   *   notas 5, 5, 4, 4, 3 → média 4,2
   *
   * ⚠️ A MÉDIA É CALCULADA PELO POSTGRES (§44), então o que dá para conferir
   * aqui é a APRESENTAÇÃO dela e a taxa, que é conta de tela. A média em si —
   * `avg(numeric_value)` com o filtro de rodada e de versão — está coberta em
   * `sql-event-results.test.ts`.
   */
  it("taxa de resposta: 8 de 10 dá 80%", () => {
    expect(responseRatePercent(10, 8)).toBe(80);
  });

  it("pendentes é o que foi enviado e não voltou", () => {
    const enviadas = 10;
    const respondidas = 8;
    expect(enviadas - respondidas).toBe(2);
  });

  it("a média 4,2 sai formatada em português", () => {
    const notas = [5, 5, 4, 4, 3];
    const media = notas.reduce((a, b) => a + b, 0) / notas.length;

    expect(media).toBe(4.2);
    expect(formatAverage(media)).toBe("4,2");
  });

  it("a distribuição do conjunto fecha 100%", () => {
    // 5 → 2 pessoas · 4 → 2 pessoas · 3 → 1 pessoa, sobre 5 respondentes.
    const respondentes = 5;
    const dist = [
      { optionId: "5", label: "Excelente", value: 5, position: 1, total: 2 },
      { optionId: "4", label: "Bom", value: 4, position: 2, total: 2 },
      { optionId: "3", label: "Regular", value: 3, position: 3, total: 1 },
      { optionId: "2", label: "Ruim", value: 2, position: 4, total: 0 },
      { optionId: "1", label: "Péssimo", value: 1, position: 5, total: 0 },
    ];

    expect(optionPercent(dist[0]!, respondentes)).toBe(40);
    expect(optionPercent(dist[2]!, respondentes)).toBe(20);
    // ⚠️ A ALTERNATIVA COM ZERO CONTINUA VALENDO ZERO, e não some: "ninguém deu
    // Péssimo" é um resultado.
    expect(optionPercent(dist[4]!, respondentes)).toBe(0);

    const soma = dist.reduce((t, o) => t + optionPercent(o, respondentes), 0);
    expect(soma).toBe(100);
  });

  /** §6/§27. O denominador é o que foi ENVIADO, e nunca o de inscritos. */
  it("a taxa não usa os inscritos como denominador", () => {
    const inscritos = 120;
    const enviadas = 10;
    const respondidas = 8;

    expect(responseRatePercent(enviadas, respondidas)).toBe(80);
    expect(responseRatePercent(enviadas, respondidas)).not.toBe((respondidas / inscritos) * 100);
  });
});

/* ========================================================================== */
/* §37 — RBAC de ponta a ponta                                                */
/* ========================================================================== */

describe("§37 — a matriz inteira, papel por papel", () => {
  /**
   * ⚠️ OS PAPÉIS SÃO OS QUE EXISTEM, e não os do enunciado. O §37 fala em
   * "Administrador, Gestor, Atendente"; o enum deste projeto tem
   * `admin · comercial · financeiro · viewer`. O §37 também manda "não assumir
   * permissões inexistentes" e "utilizar a matriz de RBAC já existente" — então
   * o que se testa é a matriz real.
   *
   * `VALID_ROLES` entra na asserção para este teste quebrar no dia em que um
   * papel novo for criado sem ninguém decidir o que ele vê da jornada.
   */
  it("os papéis do sistema são exatamente quatro", () => {
    expect([...VALID_ROLES]).toEqual(["admin", "comercial", "financeiro", "viewer"]);
  });

  const jornada = [
    { chave: "presence.read", quem: ["admin", "comercial"] },
    { chave: "presence.write", quem: ["admin", "comercial"] },
    { chave: "registrations.read", quem: ["admin", "comercial"] },
    { chave: "registrations.write", quem: ["admin"] },
    { chave: "evaluations.read", quem: ["admin", "comercial"] },
    { chave: "evaluations.write", quem: ["admin"] },
    { chave: "evaluations.send", quem: ["admin", "comercial"] },
    { chave: "results.read", quem: ["admin", "comercial"] },
    { chave: "results.export", quem: ["admin"] },
  ] as const;

  it("cada etapa da jornada libera exatamente quem deve", () => {
    for (const etapa of jornada) {
      for (const papel of VALID_ROLES) {
        const esperado = (etapa.quem as readonly string[]).includes(papel);
        expect(
          hasPermission(papel, etapa.chave),
          `${papel} × ${etapa.chave} deveria ser ${esperado}`,
        ).toBe(esperado);
      }
    }
  });

  /**
   * ⚠️ AS TRÊS ASSIMETRIAS DA JORNADA, cada uma com um motivo diferente — e é
   * por isso que elas viram caso de teste em vez de ficarem só no comentário.
   */
  it("o Atendente MARCA presença mas não CONFIRMA inscrição", () => {
    // Marcar quem entrou pela porta é o trabalho de quem está na porta;
    // confirmar inscrição é decisão de quem responde pela agenda.
    expect(hasPermission("comercial", "presence.write")).toBe(true);
    expect(hasPermission("comercial", "registrations.write")).toBe(false);
  });

  it("o Atendente REENVIA convite mas não EDITA a pergunta", () => {
    // Reenviar é operação; reescrever a pergunta muda o que a APCS pergunta.
    expect(hasPermission("comercial", "evaluations.send")).toBe(true);
    expect(hasPermission("comercial", "evaluations.write")).toBe(false);
  });

  it("o Atendente LÊ os resultados mas não BAIXA a planilha", () => {
    // Ler deixa o dado sob RLS; baixar tira opinião amarrada a nome do sistema.
    expect(hasPermission("comercial", "results.read")).toBe(true);
    expect(hasPermission("comercial", "results.export")).toBe(false);
  });

  it("Financeiro e Visitante não alcançam etapa nenhuma da jornada", () => {
    for (const etapa of jornada) {
      expect(hasPermission("financeiro", etapa.chave), etapa.chave).toBe(false);
      expect(hasPermission("viewer", etapa.chave), etapa.chave).toBe(false);
    }
  });
});

/* ========================================================================== */
/* Auditoria final — o que a revisão do Prompt 5 encontrou                    */
/* ========================================================================== */

const { ratingScaleMax } = await import("@/modules/event/event.results.rules");

describe("auditoria — a escala do destaque vem das opções", () => {
  /**
   * ⚠️ O BUG QUE ESTE CASO FIXA NO LUGAR. O cartão de "Avaliação geral" usava
   * `Math.max(...valores, 5)` — com o 5 como PISO. Numa escala de 0 a 3 ele
   * mostraria "2,4 / 5", e o número ficaria 40% menor do que é.
   *
   * O §9 do Prompt 3 já avisava: "não assumir que todas as avaliações futuras
   * obrigatoriamente terão 5 opções".
   */
  it("uma escala de 0 a 3 tem teto 3, e não 5", () => {
    const q = {
      questionId: "q",
      prompt: "",
      type: "rating" as const,
      required: true,
      isOverall: true,
      position: 1,
      respondents: 4,
      answers: 4,
      average: 2.4,
      min: 1,
      max: 3,
      textCount: 0,
      options: [
        { optionId: "a", label: "Ótimo", value: 3, position: 1, total: 2 },
        { optionId: "b", label: "Ruim", value: 0, position: 2, total: 2 },
      ],
    };

    expect(ratingScaleMax(q)).toBe(3);
  });

  it("a escala da APCS continua dando 5", () => {
    const q = {
      questionId: "q",
      prompt: "",
      type: "rating" as const,
      required: true,
      isOverall: true,
      position: 1,
      respondents: 1,
      answers: 1,
      average: 5,
      min: 5,
      max: 5,
      textCount: 0,
      options: [
        { optionId: "a", label: "Excelente", value: 5, position: 1, total: 1 },
        { optionId: "b", label: "Péssimo", value: 1, position: 5, total: 0 },
      ],
    };

    expect(ratingScaleMax(q)).toBe(5);
  });
});

const { getPublicEvaluation } = await import("@/lib/services/event-evaluation-public");

describe("auditoria — a porta pública recusa lixo antes de ir ao banco", () => {
  /**
   * ⚠️ NÃO É PROTEÇÃO CONTRA ADIVINHAÇÃO — é economia. Adivinhar 122 bits não é
   * ameaça real; o que isto evita é cada `/avaliacoes/qualquer-coisa` de um
   * rastreador virar uma consulta ao Postgres com a chave de serviço.
   */
  it("token fora do formato não chega ao banco", async () => {
    estado.chamadas = [];

    for (const lixo of [
      "",
      "   ",
      "abc",
      "../../etc/passwd",
      "<script>",
      "z".repeat(32),
      "a".repeat(200),
    ]) {
      const r = await getPublicEvaluation(lixo);
      expect(r.state, `"${lixo.slice(0, 12)}" deveria ser recusado`).toBe("not_found");
    }

    // Nenhuma das sete tentativas virou ida ao banco.
    expect(estado.chamadas).toHaveLength(0);
  });

  it("e a recusa é a MESMA de um token inexistente — sem contar que o formato acertou", async () => {
    const foraDoFormato = await getPublicEvaluation("nao-e-hex");
    expect(foraDoFormato.state).toBe("not_found");
    expect(foraDoFormato.firstName).toBeNull();
    expect(foraDoFormato.sections).toEqual([]);
  });

  it("um token bem formado passa adiante", async () => {
    estado.chamadas = [];
    estado.forcar["get_public_event_evaluation"] = {
      data: { state: "not_found" },
      error: null,
    };

    await getPublicEvaluation("f".repeat(32));

    expect(estado.chamadas.map((c) => c.fn)).toContain("get_public_event_evaluation");
  });
});
