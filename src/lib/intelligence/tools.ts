import "server-only";
import {
  getDocumentForChatbot,
  getDocumentForChatbotByName,
  listChatbotDocumentNames,
} from "@/lib/services/document-chatbot";
import { getAvailableEventsForAssociate } from "@/lib/services/event-chatbot";
import { searchKnowledgeForChatbot } from "@/lib/services/knowledge-chatbot";
import {
  getBulletinForChatbot,
  getBulletinForChatbotByName,
  listChatbotBulletins,
} from "@/lib/services/market-chatbot";
import {
  bolsaCaption,
  chooseAmong,
  CHOICE_NOUNS,
  documentCaption,
  eventsBody,
} from "@/modules/intelligence/intelligence.labels";
import type {
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "@/modules/intelligence/intelligence.types";
import type { ToolName } from "@/modules/intelligence/intent.types";
import type { DocumentCategory } from "@/modules/document/document.types";

/**
 * O TOOL REGISTRY (§13) — a única coisa que executa alguma ação de domínio.
 *
 * ⚠️ NENHUMA FERRAMENTA FALA COM O BANCO. Todas chamam uma porta de chatbot que
 * já existe (`*-chatbot.ts`), e é lá que mora a regra de publicação. É o §14 e o
 * §21 do escopo, e o motivo é concreto: se a condição "ativo + disponível +
 * vigente" pudesse ser remontada aqui, existiriam duas verdades sobre o que
 * está publicado — e a segunda envelheceria calada.
 *
 * ⚠️ E NENHUMA ESCREVE. Ver o comentário de `TOOL_NAMES`: as duas ações de
 * escrita (solicitar palestra, responder enquete) precisam coletar campos em
 * vários turnos, o que é roteiro e não roteador. Elas encaminham para uma
 * pessoa até o roteiro existir.
 *
 * ⚠️ NADA AQUI LANÇA PARA FORA. Uma exceção viraria um 500 no webhook, o
 * fornecedor reentregaria o payload e o resultado seria um laço de reentrega
 * sobre um erro que não se resolve sozinho. Toda falha vira `status: "error"`,
 * que o motor traduz na frase que a APCS escreveu para isso.
 */

/** Envolve a execução: nenhuma ferramenta precisa repetir o try/catch. */
async function seguro(
  nome: ToolName,
  contexto: ToolContext,
  executar: () => Promise<ToolResult>,
): Promise<ToolResult> {
  try {
    return await executar();
  } catch (erro) {
    console.error(
      `[intelligence.tools] ${nome} falhou`,
      // ⚠️ NUNCA O ASSUNTO NEM O TELEFONE. O log de erro é o lugar onde dado
      // pessoal vaza sem ninguém notar (§35). O `correlationId` costura este
      // registro ao evento do webhook, que é onde o contexto completo já está.
      {
        correlationId: contexto.correlationId,
        motivo: erro instanceof Error ? erro.message : String(erro),
      },
    );
    return { status: "error" };
  }
}

/**
 * O padrão que os três catálogos compartilham: com assunto, procura pelo nome;
 * sem assunto (ou sem casar), decide entre responder e perguntar.
 *
 * ⚠️ COM MAIS DE UMA PUBLICAÇÃO, PERGUNTA. Mandar a primeira da ordem
 * alfabética seria inventar uma preferência que a pessoa não expressou — e ela
 * receberia um documento errado achando que era o que pediu.
 */
async function resolverCatalogo<T>(params: {
  subject: string | null;
  porNome: (nome: string) => Promise<T | null>;
  listar: () => Promise<{ id: string; name: string }[]>;
  porId: (id: string) => Promise<T | null>;
  entregar: (item: T) => ToolResult;
  substantivo: string;
}): Promise<ToolResult> {
  if (params.subject) {
    const achado = await params.porNome(params.subject);
    if (achado) return params.entregar(achado);
    // Não achou pelo nome: cai na lista. A pessoa pode ter escrito "ambiental"
    // querendo "Câmara Ambiental", e mostrar o catálogo resolve sem adivinhação.
  }

  const catalogo = await params.listar();
  if (catalogo.length === 0) return { status: "empty" };

  if (catalogo.length === 1) {
    const unico = catalogo[0];
    if (!unico) return { status: "empty" };

    const item = await params.porId(unico.id);
    return item ? params.entregar(item) : { status: "empty" };
  }

  return {
    status: "ok",
    body: chooseAmong(
      catalogo.map((item) => item.name),
      params.substantivo,
    ),
    attachments: [],
  };
}

/** Normativas e Comunicação compartilham tudo menos a categoria. */
function ferramentaDocumental(
  name: ToolName,
  label: string,
  category: DocumentCategory,
  substantivo: string,
): ToolDefinition {
  return {
    name,
    label,
    run: (subject, contexto) =>
      seguro(name, contexto, () =>
        resolverCatalogo({
          subject,
          porNome: (nome) => getDocumentForChatbotByName(category, nome),
          listar: () => listChatbotDocumentNames(category),
          porId: getDocumentForChatbot,
          entregar: (doc) => ({
            status: "ok",
            body: documentCaption(doc.name, doc.version, doc.effectiveDate),
            attachments: [{ kind: "document", url: doc.pdfUrl, fileName: doc.fileName }],
          }),
          substantivo,
        }),
      ),
  };
}

const TOOLS: Record<ToolName, ToolDefinition> = {
  /**
   * §15/§16 — o funil da Bolsa, e nenhuma condição a menos. As três (ativa,
   * liberada para o robô, vigência chegada) são impostas dentro de
   * `market-chatbot.ts`, que é a única porta.
   *
   * ⚠️ A IMAGEM VEM ANTES DO PDF, e a ordem importa: a imagem é o que a pessoa
   * lê no celular sem abrir nada. O PDF é para guardar.
   */
  getActiveBolsa: {
    name: "getActiveBolsa",
    label: "Boletim da Bolsa de Suínos",
    run: (subject, contexto) =>
      seguro("getActiveBolsa", contexto, () =>
        resolverCatalogo({
          subject,
          porNome: getBulletinForChatbotByName,
          listar: listChatbotBulletins,
          porId: getBulletinForChatbot,
          entregar: (bolsa) => ({
            status: "ok",
            body: bolsaCaption(bolsa.name, bolsa.versionName, bolsa.effectiveDate),
            attachments: [
              { kind: "image", url: bolsa.imageUrl },
              {
                kind: "document",
                url: bolsa.pdfUrl,
                fileName: `${bolsa.versionName}.pdf`,
              },
            ],
          }),
          substantivo: CHOICE_NOUNS.bolsa,
        }),
      ),
  },

  getActiveNormativa: ferramentaDocumental(
    "getActiveNormativa",
    "Normativa vigente",
    "normative",
    CHOICE_NOUNS.normative,
  ),

  getActiveComunicacao: ferramentaDocumental(
    "getActiveComunicacao",
    "Material de comunicação",
    "communication",
    CHOICE_NOUNS.communication,
  ),

  /**
   * §18 da agenda: a lista é SEGMENTADA. O que aparece depende dos públicos do
   * associado, e é por isso que esta é a única ferramenta que pode devolver
   * `unidentified`.
   *
   * ⚠️ "NÃO SEI QUEM VOCÊ É" NÃO É "NÃO HÁ EVENTOS". Responder a agenda vazia a
   * um associado que a APCS não reconheceu seria uma afirmação falsa sobre a
   * agenda — e a pessoa desistiria de perguntar.
   */
  getActiveEvents: {
    name: "getActiveEvents",
    label: "Agenda de eventos",
    run: (_subject, contexto) =>
      seguro("getActiveEvents", contexto, async () => {
        if (!contexto.memberId) return { status: "unidentified" };

        const resultado = await getAvailableEventsForAssociate(contexto.memberId);
        if (resultado.status === "unknown-audience") return { status: "unidentified" };
        if (resultado.events.length === 0) return { status: "empty" };

        return {
          status: "ok",
          body: eventsBody(
            resultado.events.map((evento) => ({
              name: evento.name,
              eventDate: evento.eventDate,
              startTime: evento.startTime,
              location: evento.location,
            })),
          ),
          attachments: [],
        };
      }),
  },

  /**
   * A Base de Conhecimento.
   *
   * ⚠️ ELA RECEBE A MENSAGEM INTEIRA, e não o `subject`. É a única ferramenta
   * assim, e o motivo está no desenho da busca: ela casa PALAVRAS-CHAVE com o
   * que a pessoa escreveu. "Vocês abrem que horas?" não tem assunto extraível —
   * tem "horas", que é justamente a palavra-chave cadastrada. Passar só o
   * subject aqui jogaria fora o que faz a busca funcionar.
   */
  getKnowledge: {
    name: "getKnowledge",
    label: "Base de Conhecimento",
    run: (subject, contexto) =>
      seguro("getKnowledge", contexto, async () => {
        const consulta = (subject ?? "").trim();
        if (consulta.length < 2) return { status: "empty" };

        const achados = await searchKnowledgeForChatbot(consulta);
        const primeiro = achados[0];
        if (!primeiro) return { status: "empty" };

        // ⚠️ O TEXTO SAI COMO ESTÁ ESCRITO. Nada aqui resume, reescreve ou
        // combina dois itens: o §2 é que a resposta oficial é a da APCS.
        return { status: "ok", body: primeiro.content, attachments: [] };
      }),
  },
};

/** A ferramenta pelo nome. O `Record` é completo — sempre existe. */
export function toolFor(name: ToolName): ToolDefinition {
  return TOOLS[name];
}

/** Todas, para a documentação e para o teste de cobertura do registro. */
export function allTools(): ToolDefinition[] {
  return Object.values(TOOLS);
}
