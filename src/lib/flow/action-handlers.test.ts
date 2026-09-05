import { beforeEach, describe, expect, it, vi } from "vitest";
import { FLOW_ACTION_KEYS } from "@/modules/flow/flow.actions.registry";
import type { ToolContext, ToolResult } from "@/modules/intelligence/intelligence.types";
import type { ToolName } from "@/modules/intelligence/intent.types";

/**
 * §17 A §27 DO PROMPT 4 — as ações de negócio.
 *
 * ============================================================================
 * ⚠️ O QUE ESTES TESTES PROVAM: DELEGAÇÃO, E NÃO CONSULTA.
 * ============================================================================
 *
 * A regra de publicação ("versão ativa + liberada para o chatbot + vigente")
 * NÃO é testada aqui, e a ausência é o ponto. Ela mora em `*-chatbot.ts` e já
 * tem os testes dela; reproduzi-la aqui criaria uma SEGUNDA descrição do que
 * está publicado, e a segunda envelheceria calada.
 *
 * O que se testa é que cada handler CHAMA a ferramenta certa e traduz os quatro
 * desfechos dela sem colapsar dois num só — que é o único trabalho que este
 * arquivo faz, e o único lugar onde ele pode errar.
 */

const chamadas: { tool: ToolName; subject: string | null; contexto: ToolContext }[] = [];
let resposta: ToolResult = { status: "empty" };

vi.mock("@/lib/intelligence/tools", () => ({
  toolFor: (name: ToolName) => ({
    name,
    label: name,
    run: async (subject: string | null, contexto: ToolContext) => {
      chamadas.push({ tool: name, subject, contexto });
      return resposta;
    },
  }),
}));

const alvo = {
  chatId: "ccccccc1-0000-4000-8000-000000000001",
  chatKey: "5519991234567",
  phone: "5519991234567",
  contactId: "aaaaaaa1-0000-4000-8000-000000000001",
  memberId: "bbbbbbb1-0000-4000-8000-000000000001",
};

vi.mock("@/lib/services/whatsapp-bot", () => ({
  getBotChatTarget: vi.fn(async () => alvo),
}));

const palestra = {
  status: "found" as const,
  lecture: {
    protocol: "APCS-0042",
    status: "requested" as const,
    statusLabel: "Solicitada",
    statusHint: "Recebemos seu pedido e a equipe vai avaliar.",
    theme: "Manejo sanitário",
    city: "Piracicaba",
    eventDate: "2026-11-20",
    startTime: null,
    requestedAt: "2026-09-01T12:00:00Z",
  },
};
let palestraResposta: { status: "found" | "not-found"; lecture?: typeof palestra.lecture } =
  palestra;

vi.mock("@/lib/services/lecture-chatbot", () => ({
  getLectureRequestByProtocol: vi.fn(async () => palestraResposta),
}));

await import("./action-handlers");
const { FLOW_ACTION_HANDLERS, flowActionHandler, isFlowActionReady } =
  await import("@/modules/flow/flow.actions.registry");
const { pendingFlowActions } = await import("@/modules/flow/flow.rules");

const ENTRADA = {
  variables: {} as Record<string, string>,
  whatsappChatId: alvo.chatId,
  idempotencyKey: "evt-1:1:0",
};

async function rodar(chave: string, variables: Record<string, string> = {}) {
  const handler = flowActionHandler(chave as never);
  if (!handler) throw new Error(`sem handler: ${chave}`);
  return handler({ ...ENTRADA, variables });
}

beforeEach(() => {
  chamadas.length = 0;
  resposta = { status: "empty" };
  palestraResposta = palestra;
});

/* -------------------------------------------------------------------------- */
/* O registro                                                                 */
/* -------------------------------------------------------------------------- */

describe("o que está ligado, e o que não está", () => {
  it("liga as cinco consultas e o andamento de palestra", () => {
    expect(Object.keys(FLOW_ACTION_HANDLERS).sort()).toEqual([
      "consultar_bolsa",
      "consultar_comunicacao",
      "consultar_conhecimento",
      "consultar_evento",
      "consultar_normativa",
      "consultar_palestra",
    ]);
  });

  /**
   * ⚠️ AS QUATRO SEM HANDLER SÃO UM ESTADO LEGÍTIMO, e este teste registra que
   * é deliberado — não esquecimento. Duas escrevem sem porta de domínio para
   * delegar (`registrar_lead`, `criar_ticket`), uma precisa de campos que o
   * registro ainda não declara (`solicitar_palestra`), e outra precisa de um id
   * que o fluxo não tem de onde tirar (`participar_enquete`).
   *
   * A publicação recusa fluxos que dependam delas, então o desenhador descobre
   * no botão de publicar — e não o associado, no meio do atendimento.
   */
  it.each(["registrar_lead", "criar_ticket", "solicitar_palestra", "participar_enquete"])(
    "deixa %s sem handler, e a publicação a recusa",
    (chave) => {
      expect(isFlowActionReady(chave as never)).toBe(false);
    },
  );

  it("não inventa uma chave fora do registro", () => {
    for (const chave of Object.keys(FLOW_ACTION_HANDLERS)) {
      expect(FLOW_ACTION_KEYS).toContain(chave);
    }
  });

  /**
   * ============================================================================
   * ⚠️ O TESTE QUE GUARDA UM DEFEITO QUE QUASE PASSOU.
   * ============================================================================
   *
   * `publishFlowVersionAction` pergunta a `pendingFlowActions` quais ações do
   * desenho ainda não têm handler, e a resposta sai deste registro — que nasce
   * VAZIO no módulo puro e só é preenchido por quem importar
   * `lib/flow/action-handlers`.
   *
   * Na primeira versão, só `lib/flow/runtime.ts` o importava. O motor atendia
   * normalmente, e o botão de publicar RECUSAVA todo fluxo com Bolsa, normativa
   * ou agenda, dizendo "esta ação ainda não está pronta" sobre ações que
   * estavam funcionando em produção. Nada falhava; só a publicação mentia.
   *
   * A correção foi um segundo import, em `lib/actions/flows.ts`. Este teste
   * fixa a propriedade da qual a publicação depende: carregado o módulo, as
   * ações ligadas param de aparecer como pendentes.
   */
  it("uma ação ligada deixa de ser pendente para a publicação", () => {
    const desenho = {
      nodes: [
        {
          id: "n1",
          type: "action" as const,
          key: "CONSULTA",
          name: "Consulta",
          isStart: false,
          configuration: { actionKey: "consultar_bolsa" },
          position: { x: 0, y: 0 },
          metadata: {},
        },
      ],
      transitions: [],
    };

    expect(pendingFlowActions(desenho as never)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* §17, §19 — a Bolsa                                                         */
/* -------------------------------------------------------------------------- */

describe("consultar_bolsa", () => {
  beforeEach(() => {
    resposta = {
      status: "ok",
      body: "Bolsa de Suínos — 03/09/2026",
      attachments: [
        { kind: "image", url: "https://exemplo/bolsa.png" },
        { kind: "document", url: "https://exemplo/bolsa.pdf", fileName: "bolsa.pdf" },
      ],
      source: { type: "market_bulletin", id: "b1" },
    };
  });

  it("chama a ferramenta do robô, e não o banco", async () => {
    await rodar("consultar_bolsa");
    expect(chamadas[0]?.tool).toBe("getActiveBolsa");
  });

  /**
   * §19. AS DUAS URLS SAEM SEPARADAS — a imagem é o que a pessoa lê no celular
   * sem abrir nada, o PDF é para guardar. Quem decide o que mandar, e em que
   * ordem, é o DESENHO: são dois nós de mensagem com `{{bolsa_imagem_url}}` e
   * `{{bolsa_pdf_url}}`.
   */
  it("devolve imagem e PDF como variáveis distintas", async () => {
    const saida = await rodar("consultar_bolsa");

    expect(saida).toEqual({
      ok: true,
      variables: {
        bolsa_titulo: "Bolsa de Suínos — 03/09/2026",
        bolsa_imagem_url: "https://exemplo/bolsa.png",
        bolsa_pdf_url: "https://exemplo/bolsa.pdf",
        bolsa_url: "https://exemplo/bolsa.pdf",
      },
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Os quatro desfechos, sem colapsar dois num só                              */
/* -------------------------------------------------------------------------- */

describe("a tradução dos desfechos", () => {
  /**
   * ⚠️ "NÃO HÁ PUBLICAÇÃO VIGENTE" NÃO É FALHA. Vira `not_found`, e é uma
   * resposta útil — "não encontrei normativa sobre esse assunto" é informação,
   * não defeito. Repetir a consulta daria a mesma coisa.
   */
  it("vazio vira not_found, e não erro", async () => {
    resposta = { status: "empty" };
    expect(await rodar("consultar_normativa", { assunto: "Câmara Ambiental" })).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  /**
   * ⚠️ ERRO VIRA `retry`, E NÃO `error`. A ferramenta captura QUALQUER exceção
   * num `status: "error"` só, de onde não dá para distinguir "o Supabase
   * piscou" de "há um defeito". Como o teto de tentativas de um nó é 1 por
   * padrão, isto NÃO faz o sistema insistir sozinho: só permite que o
   * desenhador PEÇA a insistência no nó onde ela vale.
   */
  it("erro vira retry, para o desenhador poder pedir insistência", async () => {
    resposta = { status: "error" };
    expect(await rodar("consultar_comunicacao", { assunto: "ISP" })).toEqual({
      ok: false,
      reason: "retry",
    });
  });

  /**
   * ============================================================================
   * ⚠️ O DESFECHO QUE JUSTIFICOU MEXER NO CONTRATO DA AÇÃO.
   * ============================================================================
   *
   * A agenda é SEGMENTADA por público. "Não há eventos para você" e "não sei
   * quem você é" caem os dois em `not_found` — e responder "não há eventos
   * marcados" a um associado que a APCS simplesmente não reconheceu pelo
   * telefone seria uma afirmação FALSA sobre a agenda. A pessoa pararia de
   * perguntar.
   *
   * Por isso o ramo de fracasso de `FlowActionOutput` ganhou `variables`: o
   * desfecho continua `not_found`, e o desenho ganha o material para dizer a
   * coisa certa.
   */
  it("separa 'não te reconheci' de 'não há nada'", async () => {
    resposta = { status: "unidentified" };
    expect(await rodar("consultar_evento")).toEqual({
      ok: false,
      reason: "empty",
      variables: { motivo: "nao_identificado" },
    });
  });
});

/* -------------------------------------------------------------------------- */
/* §26, §46 — o assunto que a IA extraiu vira argumento                       */
/* -------------------------------------------------------------------------- */

describe("de onde sai o assunto", () => {
  beforeEach(() => {
    resposta = { status: "ok", body: "texto", attachments: [], source: null };
  });

  /**
   * §46. A CORRENTE COMPLETA: a pessoa escreve "quero a normativa da Câmara
   * Ambiental", a IA devolve `subject`, isso vira `sys_intent_subject`, e a
   * ação procura por ele — sem ninguém ter desenhado uma pergunta pedindo o
   * assunto.
   */
  it("usa o assunto que a IA extraiu quando não há um coletado", async () => {
    await rodar("consultar_normativa", { sys_intent_subject: "Câmara Ambiental" });
    expect(chamadas[0]?.subject).toBe("Câmara Ambiental");
  });

  /**
   * ⚠️ MAS O QUE A PESSOA RESPONDEU GANHA. Uma variável coletada numa PERGUNTA
   * é mais confiável que a leitura de um modelo: ela é o que a pessoa disse
   * quando lhe perguntaram diretamente.
   */
  it("prefere o assunto coletado numa pergunta", async () => {
    await rodar("consultar_normativa", {
      assunto: "Câmara Setorial",
      sys_intent_subject: "Câmara Ambiental",
    });
    expect(chamadas[0]?.subject).toBe("Câmara Setorial");
  });

  /**
   * ⚠️ A BASE DE CONHECIMENTO RECEBE A PERGUNTA INTEIRA, e é a única assim. A
   * busca casa PALAVRAS-CHAVE com o que a pessoa escreveu: "vocês abrem que
   * horas?" não tem assunto extraível, tem "horas" — que é a chave cadastrada.
   * Ver o comentário em `tools.ts::getKnowledge`, que registra a vez em que
   * isso deu errado de verdade.
   */
  it("passa a pergunta inteira para a Base de Conhecimento", async () => {
    await rodar("consultar_conhecimento", { pergunta: "vocês abrem que horas?" });
    expect(chamadas[0]?.contexto.message).toBe("vocês abrem que horas?");
  });
});

/* -------------------------------------------------------------------------- */
/* §37 do Prompt 3, §48 — quem está falando sai do banco                      */
/* -------------------------------------------------------------------------- */

describe("a identidade de quem pergunta", () => {
  /**
   * ============================================================================
   * ⚠️ O TESTE DE SEGURANÇA DESTE ARQUIVO.
   * ============================================================================
   *
   * O caminho tentador era ler `variables["telefone"]`, que o fluxo pode ter
   * coletado numa pergunta. Isso deixaria alguém digitar o telefone de OUTRO
   * associado e receber a agenda de eventos dele — a agenda é segmentada por
   * público, então seria vazamento de verdade, por um campo de texto livre.
   *
   * A identidade sai de `getBotChatTarget`, que lê pelo id da conversa que o
   * próprio webhook gravou.
   */
  it("ignora um telefone que a pessoa tenha digitado", async () => {
    resposta = { status: "ok", body: "agenda", attachments: [], source: null };

    await rodar("consultar_evento", {
      telefone: "5511999999999",
      memberId: "id-de-outra-pessoa",
    });

    expect(chamadas[0]?.contexto.phone).toBe(alvo.phone);
    expect(chamadas[0]?.contexto.memberId).toBe(alvo.memberId);
  });
});

/* -------------------------------------------------------------------------- */
/* §24 — o andamento de uma solicitação de palestra                           */
/* -------------------------------------------------------------------------- */

describe("consultar_palestra", () => {
  it("devolve a situação já traduzida pelo módulo", async () => {
    const saida = await rodar("consultar_palestra", { protocolo: "APCS-0042" });

    expect(saida.ok).toBe(true);
    expect(saida.ok && saida.variables["palestra_situacao"]).toBe("Solicitada");
    expect(saida.ok && saida.variables["palestra_tema"]).toBe("Manejo sanitário");
  });

  /** Sem protocolo não há o que procurar — e isso é erro de desenho, não vazio. */
  it("recusa sem protocolo", async () => {
    expect(await rodar("consultar_palestra")).toEqual({ ok: false, reason: "error" });
  });

  /**
   * ⚠️ UM PROTOCOLO NÃO ENCONTRADO E UM DE OUTRA PESSOA CAEM NO MESMO LUGAR, e
   * é assim que tem de ser: distinguir os dois diria a quem chutou "APCS-0042"
   * que aquele protocolo EXISTE. O pareamento com o contato mora em
   * `getLectureRequestByProtocol` — ver o §48.
   */
  it("não distingue 'não existe' de 'não é seu'", async () => {
    palestraResposta = { status: "not-found" };
    expect(await rodar("consultar_palestra", { protocolo: "APCS-0042" })).toEqual({
      ok: false,
      reason: "empty",
    });
  });
});
