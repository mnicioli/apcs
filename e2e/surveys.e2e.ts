import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { FakeProvider } from "@/lib/messaging/providers/fake";
import { __setMessagingProvider } from "@/lib/messaging/registry";
import { runSurveyDispatch, __resetDispatchBreaker } from "@/lib/services/survey-dispatch";
import { runSurveyTick } from "@/lib/services/survey-scheduler";
import { POST as webhookPost, GET as webhookGet } from "@/app/api/webhooks/whatsapp/route";
import { NextRequest } from "next/server";

/**
 * §77, §78. O CICLO COMPLETO, CONTRA O BANCO DE PRODUÇÃO.
 *
 *   Criar → pergunta → alternativas → público → agendar → scheduler → fila →
 *   WhatsApp (falso) → associado recebe → responde → webhook → registra →
 *   resultado.
 *
 * ⚠️ DUAS DECISÕES SOBRE COMO ESTE TESTE TOCA O BANCO REAL:
 *
 * 1. Ele cria a PRÓPRIA enquete, com a pergunta e as alternativas do §78, em
 *    vez de usar a do seed. Ativar e encerrar a do seed seria IRREVERSÍVEL — o
 *    grafo de situações não tem volta de `closed` (§13 do PROMPT 1/3), e a
 *    homologação deixaria a base num estado que ninguém pediu.
 *
 * 2. Tudo que ele cria é apagado no fim, e o `afterAll` roda mesmo com teste
 *    vermelho. Sem isso, uma falha no meio deixaria doze contatos de teste e
 *    uma campanha órfã na base de verdade.
 */

const admin = createAdminClient();
const fake = new FakeProvider("segredo-e2e");

const TITULO = "Expectativa sobre o valor da @ do suíno — homologação E2E";
const PERGUNTA = "Como você acredita que ficará o valor da @ do suíno nas próximas semanas?";
const ALTERNATIVAS = ["Aumentar muito", "Aumentar", "Manter", "Reduzir", "Reduzir muito"];

const MARCA = "E2E-P3";

let surveyId = "";
const contatos: { id: string; nome: string; fone: string }[] = [];

/** §78 pede pelo menos 10. São 12: 10 celulares, 1 fixo e 1 que pede para sair. */
const CELULARES = 10;
const FONE_FIXO = "(14) 3622-0001";

async function sql<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(nome as never, args as never);
  if (error) throw new Error(`${nome}: ${error.message}`);
  return data as T;
}

beforeAll(async () => {
  __setMessagingProvider(fake);
  __resetDispatchBreaker();

  // 1. Doze contatos de teste.
  for (let i = 1; i <= CELULARES + 2; i += 1) {
    const fone = i === CELULARES + 1 ? FONE_FIXO : `(19) 9922${String(i).padStart(5, "0")}`;
    const { data, error } = await admin
      .from("chat_contacts")
      .insert({
        full_name: `${MARCA} Associado ${i}`,
        city: "Piracicaba",
        state: "SP",
        contact_profile: "producer",
        phone: fone,
      })
      .select("id")
      .single();
    if (error) throw error;
    contatos.push({ id: data.id, nome: `${MARCA} Associado ${i}`, fone });
  }

  // 2. A enquete do §78.
  const criada = await sql<{ id: string }>("create_survey", {
    p_title: TITULO,
    p_description: "Homologação do PROMPT 3/3. Apagada ao fim.",
    p_question: PERGUNTA,
    p_options: ALTERNATIVAS,
    p_starts_at: new Date(Date.now() - 3600_000).toISOString(),
    p_ends_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    p_scheduled_at: new Date(Date.now() - 60_000).toISOString(),
  });
  surveyId = criada.id;
});

afterAll(async () => {
  // ⚠️ Roda mesmo com teste vermelho. É o que impede que uma falha no meio
  // deixe lixo na base de produção.
  if (surveyId) {
    await admin.from("survey_conversation_states").delete().eq("survey_id", surveyId);
    await admin.from("survey_responses").delete().eq("survey_id", surveyId);
    await admin.from("survey_recipients").delete().eq("survey_id", surveyId);
    await admin.from("survey_dispatches").delete().eq("survey_id", surveyId);
    await admin.from("survey_audience_criteria").delete().eq("survey_id", surveyId);
    await admin.from("survey_audit_logs").delete().eq("survey_id", surveyId);
    const { data: q } = await admin.from("survey_questions").select("id").eq("survey_id", surveyId);
    for (const linha of q ?? []) {
      await admin.from("survey_options").delete().eq("question_id", linha.id);
    }
    await admin.from("survey_questions").delete().eq("survey_id", surveyId);
    await admin.from("surveys").delete().eq("id", surveyId);
  }

  for (const c of contatos) {
    await admin.from("notification_opt_outs").delete().eq("contact_id", c.id);
    await admin.from("survey_conversation_states").delete().eq("contact_id", c.id);
    await admin.from("chat_contacts").delete().eq("id", c.id);
  }

  // ⚠️ Por `provider_event_id`, e não por `correlation_id`: o correlation é um
  // UUID novo a cada requisição e nunca casaria com a marca. Com o filtro
  // errado os eventos sobreviviam entre rodadas, a idempotência os recusava
  // (corretamente) e a bateria seguinte via "nenhuma resposta registrada".
  await admin.from("survey_inbound_events").delete().like("provider_event_id", `${MARCA}-%`);
  await admin.from("survey_inbound_events").delete().like("provider_event_id", "forjado-%");
  await admin.from("survey_inbound_events").delete().like("provider_event_id", "fake.%");
  __setMessagingProvider(null);
});

function e164(fone: string) {
  return `55${fone.replace(/\D/g, "")}`;
}

/** Monta um POST assinado, exatamente como a Meta manda. */
function requisicaoAssinada(payload: unknown, segredo = "segredo-e2e") {
  const corpo = JSON.stringify(payload);
  const assinatura = `sha256=${createHmac("sha256", segredo).update(corpo, "utf8").digest("hex")}`;
  return new NextRequest("https://apcs.test/api/webhooks/whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": assinatura,
      "content-length": String(Buffer.byteLength(corpo)),
    },
    body: corpo,
  });
}

function eventoMensagem(de: string, texto: string, id: string, citando?: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            field: "messages",
            value: {
              messages: [
                {
                  id,
                  from: de,
                  timestamp: "1770000000",
                  text: { body: texto },
                  ...(citando ? { context: { id: citando } } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function eventoStatus(providerMessageId: string, status: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1",
        changes: [
          {
            field: "messages",
            value: { statuses: [{ id: providerMessageId, status, timestamp: "1770000001" }] },
          },
        ],
      },
    ],
  };
}

describe("§77. O ciclo completo", () => {
  it("1. público: os doze contatos entram na segmentação", async () => {
    await sql("set_survey_audience", {
      p_survey_id: surveyId,
      p_criteria: contatos.map((c) => ({ dimension: "contact", contactId: c.id })),
    });

    const total = await sql<number>("count_survey_audience", { p_survey_id: surveyId });
    expect(total).toBe(12);
  });

  it("2. agendar fotografa o público (§34)", async () => {
    await sql("schedule_survey", {
      p_survey_id: surveyId,
      p_scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      p_starts_at: new Date(Date.now() - 3600_000).toISOString(),
      p_ends_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    });

    const { count } = await admin
      .from("survey_recipients")
      .select("id", { count: "exact", head: true })
      .eq("survey_id", surveyId);

    // A fotografia bate com a estimativa — é a garantia do §33/§34.
    expect(count).toBe(12);
  });

  it("3. §32: quem pediu para sair não recebe", async () => {
    const ultimo = contatos[contatos.length - 1]!;
    await sql("register_survey_opt_out", {
      p_contact_id: ultimo.id,
      p_channel: "whatsapp",
      p_source: "manual",
      p_note: "homologação",
    });

    const { count } = await admin
      .from("notification_opt_outs")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", ultimo.id);
    expect(count).toBe(1);
  });

  it("4. ⚠️ O CICLO SOZINHO ativa e dispara (§66, §89)", async () => {
    // Uma passada só faz as duas coisas: `process_scheduled_surveys` ativa o
    // que venceu, e a fila é consumida em seguida. É o que um cron a cada 5
    // minutos produz sem ninguém clicar em nada.
    const r = await runSurveyTick(fake);

    const { data } = await admin.from("surveys").select("status").eq("id", surveyId).single();
    expect(data?.status).toBe("active");
    expect(r.activated).toBeGreaterThanOrEqual(1);

    // 10 celulares saem; o fixo vira erro (§30) e quem optou por sair foi
    // bloqueado antes de entrar na fila (§32).
    expect(fake.sent).toHaveLength(CELULARES);

    const desteDisparo = r.dispatches.find((d) => d.surveyId === surveyId);
    expect(desteDisparo?.sent).toBe(CELULARES);
    expect(desteDisparo?.blocked).toBe(1);
  });

  it("5. §29/§30: o telefone fixo virou erro com a frase que diz o que fazer", async () => {
    const { data: fixo } = await admin
      .from("survey_recipients")
      .select("status, last_error, attempts")
      .eq("survey_id", surveyId)
      .eq("contact_phone", FONE_FIXO)
      .single();

    expect(fixo?.status).toBe("error");
    expect(fixo?.last_error).toMatch(/cadastre um celular/i);
    // ⚠️ Nunca foi ao fornecedor: a checagem acontece antes da chamada.
    expect(fake.sent.some((m) => m.to === e164(FONE_FIXO))).toBe(false);
  });

  it("6. a mensagem é a do §5", () => {
    const corpo = fake.sent[0]?.body ?? "";
    expect(corpo).toContain("APCS");
    expect(corpo).toContain(PERGUNTA);
    for (const alternativa of ALTERNATIVAS) expect(corpo).toContain(alternativa);
    expect(corpo).toMatch(/responda com o número/i);
  });

  it("7. §7: cada envio abriu um contexto de conversa", async () => {
    const { count } = await admin
      .from("survey_conversation_states")
      .select("id", { count: "exact", head: true })
      .eq("survey_id", surveyId)
      .eq("status", "awaiting_reply");

    expect(count).toBe(CELULARES);
  });

  it("8. §76: rodar o ciclo de novo NÃO manda segunda mensagem", async () => {
    const antes = fake.sent.length;
    await runSurveyTick(fake);
    await runSurveyDispatch(surveyId, fake, { messagesPerSecond: 10_000, backoff: () => 0 });
    expect(fake.sent.length).toBe(antes);
  });

  it("9. §26: o webhook de status sobe a escala", async () => {
    const primeiro = fake.sent[0]!;
    const { data: destinatario } = await admin
      .from("survey_recipients")
      .select("id, provider_message_id")
      .eq("survey_id", surveyId)
      .eq("contact_phone", contatos[0]!.fone)
      .single();

    const wamid = destinatario!.provider_message_id!;
    expect(primeiro.to).toBe(e164(contatos[0]!.fone));

    for (const estado of ["delivered", "read"]) {
      const resposta = await webhookPost(requisicaoAssinada(eventoStatus(wamid, estado)));
      expect(resposta.status).toBe(200);
    }

    const { data: depois } = await admin
      .from("survey_recipients")
      .select("status")
      .eq("id", destinatario!.id)
      .single();
    expect(depois?.status).toBe("read");
  });

  it("10. §62: seis pessoas respondem pelo webhook", async () => {
    const escolhas = [1, 1, 2, 2, 3, 5];

    for (const [i, escolha] of escolhas.entries()) {
      const resposta = await webhookPost(
        requisicaoAssinada(
          eventoMensagem(e164(contatos[i]!.fone), String(escolha), `${MARCA}-msg-${i}`),
        ),
      );
      expect(resposta.status).toBe(200);
    }

    const { count } = await admin
      .from("survey_responses")
      .select("id", { count: "exact", head: true })
      .eq("survey_id", surveyId);

    expect(count).toBe(escolhas.length);
  });

  it("11. §64: o MESMO webhook reentregue não vira segunda resposta", async () => {
    const evento = eventoMensagem(e164(contatos[0]!.fone), "1", `${MARCA}-msg-0`);

    for (let i = 0; i < 3; i += 1) {
      const r = await webhookPost(requisicaoAssinada(evento));
      const corpo = (await r.json()) as { duplicates: number };
      expect(corpo.duplicates).toBe(1);
    }

    const { count } = await admin
      .from("survey_responses")
      .select("id", { count: "exact", head: true })
      .eq("survey_id", surveyId);
    expect(count).toBe(6);
  });

  it("12. §63: duas respostas SIMULTÂNEAS da mesma pessoa geram uma só", async () => {
    const contato = contatos[6]!;

    const [a, b] = await Promise.all([
      webhookPost(
        requisicaoAssinada(eventoMensagem(e164(contato.fone), "4", `${MARCA}-corrida-a`)),
      ),
      webhookPost(
        requisicaoAssinada(eventoMensagem(e164(contato.fone), "5", `${MARCA}-corrida-b`)),
      ),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const { count } = await admin
      .from("survey_responses")
      .select("id", { count: "exact", head: true })
      .eq("survey_id", surveyId)
      .eq("contact_id", contato.id);

    // O índice único de `survey_responses` é quem garante isso — não um `if`.
    expect(count).toBe(1);
  });

  it("13. §11: resposta inválida não entra na urna", async () => {
    const contato = contatos[7]!;
    const antes = await contarRespostas();

    await webhookPost(
      requisicaoAssinada(eventoMensagem(e164(contato.fone), "9", `${MARCA}-invalida`)),
    );

    expect(await contarRespostas()).toBe(antes);
    const ultima = fake.sent[fake.sent.length - 1]?.body ?? "";
    expect(ultima).toMatch(/não identificamos uma opção válida/i);
    expect(ultima).toContain("1 - Aumentar muito");
  });

  it("14. §39: 'bom dia' não é erro nem resposta — o bot cala", async () => {
    const contato = contatos[8]!;
    const antesEnvios = fake.sent.length;
    const antes = await contarRespostas();

    await webhookPost(
      requisicaoAssinada(eventoMensagem(e164(contato.fone), "bom dia!", `${MARCA}-bomdia`)),
    );

    expect(await contarRespostas()).toBe(antes);
    expect(fake.sent.length).toBe(antesEnvios);
  });

  it("15. §32: 'SAIR' registra o opt-out pelo chatbot", async () => {
    const contato = contatos[8]!;

    await webhookPost(
      requisicaoAssinada(eventoMensagem(e164(contato.fone), "SAIR", `${MARCA}-sair`)),
    );

    const { count } = await admin
      .from("notification_opt_outs")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contato.id);
    expect(count).toBe(1);
    expect(fake.sent[fake.sent.length - 1]?.body).toMatch(/não receberá mais enquetes/i);
  });

  it("16. ⚠️ as funções de RESULTADO recusam o service_role (§56, §57)", async () => {
    // Isto NÃO é um contratempo do teste — é a verificação de que a porta está
    // fechada. `survey_results`, `survey_metrics` e os contadores conferem
    // `survey_is_reader()`, que exige papel de usuário. O worker e o webhook,
    // que rodam sem sessão, não conseguem ler resultado nenhum: a chave
    // service_role serve para REGISTRAR resposta, não para consultá-las.
    //
    // Os números em si são conferidos na bateria SQL, com papel de admin.
    const portas: [string, Record<string, unknown>][] = [
      ["survey_results", { p_survey_id: surveyId }],
      ["survey_metrics", { p_survey_id: surveyId }],
      ["survey_participants", { p_survey_id: surveyId }],
      ["reconcile_survey_counters", { p_survey_id: surveyId }],
      ["survey_observability_counters", { p_since: null }],
    ];

    for (const [funcao, args] of portas) {
      const { error } = await admin.rpc(funcao as never, args as never);
      expect(error, funcao).not.toBeNull();
      expect(error?.message, funcao).toMatch(/permissão/i);
    }
  });

  it("17. §47: as respostas persistidas são a verdade", async () => {
    // A contagem crua da tabela — sem passar por função de leitura nenhuma.
    const total = await contarRespostas();
    expect(total).toBe(7);

    const { data: linhas } = await admin
      .from("survey_responses")
      .select("contact_id")
      .eq("survey_id", surveyId);

    // §18: uma resposta por pessoa. Sem contato repetido.
    const pessoas = new Set((linhas ?? []).map((l) => l.contact_id));
    expect(pessoas.size).toBe(total);
  });

  it("18. §35: a corrida ficou registrada com os números", async () => {
    const { data: corridas } = await admin
      .from("survey_dispatches")
      .select("status, total_recipients, total_sent, total_errors, finished_at")
      .eq("survey_id", surveyId)
      .order("started_at", { ascending: true });

    expect((corridas ?? []).length).toBeGreaterThanOrEqual(1);
    const primeira = corridas![0]!;
    expect(primeira.status).toBe("completed");
    expect(primeira.total_sent).toBe(CELULARES);
    expect(primeira.finished_at).not.toBeNull();

    // §91. E a trilha tem o par início/fim.
    const { data: trilha } = await admin
      .from("survey_audit_logs")
      .select("action")
      .eq("survey_id", surveyId);
    const acoes = (trilha ?? []).map((t) => t.action);
    expect(acoes).toContain("survey_dispatched");
    expect(acoes).toContain("survey_dispatch_completed");
  });

  it("19. §16: cada webhook virou UMA linha de evento", async () => {
    const { data: eventos } = await admin
      .from("survey_inbound_events")
      .select("provider_event_id, outcome")
      .like("provider_event_id", `${MARCA}-%`);

    const ids = (eventos ?? []).map((e) => e.provider_event_id);
    // Nenhum id repetido — a unicidade (provider, provider_event_id) é o que
    // transforma reentrega em "já vi este".
    expect(new Set(ids).size).toBe(ids.length);

    const desfechos = (eventos ?? []).map((e) => e.outcome);
    expect(desfechos).toContain("registered");
    expect(desfechos).toContain("invalid_option");
    expect(desfechos).toContain("opt_out");
  });

  it("20. §41/§67: encerrada, a enquete recusa resposta", async () => {
    await sql("close_survey", { p_survey_id: surveyId });
    const antes = await contarRespostas();

    const contato = contatos[9]!;
    await webhookPost(
      requisicaoAssinada(eventoMensagem(e164(contato.fone), "1", `${MARCA}-tarde`)),
    );

    expect(await contarRespostas()).toBe(antes);
    expect(fake.sent[fake.sent.length - 1]?.body).toMatch(/já foi encerrada/i);
  });
});

describe("§80. Homologação de segurança do webhook", () => {
  it("⚠️ payload SEM assinatura é recusado com 401", async () => {
    const corpo = JSON.stringify(eventoMensagem(e164(contatos[0]!.fone), "1", "forjado-1"));
    const req = new NextRequest("https://apcs.test/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: corpo,
    });

    expect((await webhookPost(req)).status).toBe(401);
  });

  it("⚠️ assinatura de OUTRO segredo é recusada", async () => {
    const req = requisicaoAssinada(
      eventoMensagem(e164(contatos[0]!.fone), "1", "forjado-2"),
      "segredo-do-invasor",
    );
    expect((await webhookPost(req)).status).toBe(401);
  });

  it("⚠️ corpo adulterado depois de assinado é recusado", async () => {
    const original = eventoMensagem(e164(contatos[0]!.fone), "1", "forjado-3");
    const corpo = JSON.stringify(original);
    const assinatura = `sha256=${createHmac("sha256", "segredo-e2e").update(corpo, "utf8").digest("hex")}`;

    const adulterado = JSON.stringify(eventoMensagem(e164(contatos[1]!.fone), "5", "forjado-3"));
    const req = new NextRequest("https://apcs.test/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": assinatura },
      body: adulterado,
    });

    expect((await webhookPost(req)).status).toBe(401);
  });

  it("nenhum evento forjado virou linha no banco", async () => {
    const { count } = await admin
      .from("survey_inbound_events")
      .select("id", { count: "exact", head: true })
      .like("provider_event_id", "forjado-%");
    expect(count).toBe(0);
  });

  it("payload assinado mas absurdo devolve 200 sem efeito", async () => {
    // Reentregar não conserta JSON estranho — devolver erro faria a Meta
    // insistir por horas.
    for (const lixo of [{ object: "page" }, { qualquer: "coisa" }, []]) {
      const r = await webhookPost(requisicaoAssinada(lixo));
      expect(r.status).toBe(200);
    }
  });

  it("SQL injection no texto da resposta não vira consulta", async () => {
    const antes = await contarRespostas();
    await webhookPost(
      requisicaoAssinada(
        eventoMensagem(e164(contatos[3]!.fone), "1; drop table surveys; --", `${MARCA}-injection`),
      ),
    );
    expect(await contarRespostas()).toBe(antes);

    const { count } = await admin.from("surveys").select("id", { count: "exact", head: true });
    expect((count ?? 0) > 0).toBe(true);
  });

  it("o handshake GET recusa token errado", async () => {
    const url =
      "https://apcs.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123";
    const r = await webhookGet(new NextRequest(url));
    expect(r.status).toBe(403);
  });
});

async function contarRespostas() {
  const { count } = await admin
    .from("survey_responses")
    .select("id", { count: "exact", head: true })
    .eq("survey_id", surveyId);
  return count ?? 0;
}
