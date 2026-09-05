import "server-only";
import { toolFor } from "@/lib/intelligence/tools";
import { getLectureRequestByProtocol } from "@/lib/services/lecture-chatbot";
import { getBotChatTarget } from "@/lib/services/whatsapp-bot";
import {
  FLOW_ACTION_HANDLERS,
  type FlowActionHandler,
  type FlowActionInput,
  type FlowActionOutput,
} from "@/modules/flow/flow.actions.registry";
import type { ToolContext, ToolResult } from "@/modules/intelligence/intelligence.types";
import type { ToolName } from "@/modules/intelligence/intent.types";

/**
 * OS HANDLERS DE NEGÓCIO — §17 a §27 do Prompt 4.
 *
 * ============================================================================
 * ⚠️ NENHUM DELES CONSULTA O BANCO. LEIA ISTO ANTES DE ACRESCENTAR O PRÓXIMO.
 * ============================================================================
 *
 * Todos chamam uma FERRAMENTA que já existe (`lib/intelligence/tools.ts`), que
 * por sua vez chama uma porta de chatbot que já existe (`*-chatbot.ts`), que é
 * onde mora a regra de publicação: ativo + disponível para o chatbot + vigente.
 *
 * O §18 e o §21 pedem "nunca retornar versão antiga". A forma de isso ser
 * verdade é não haver, em lugar nenhum deste arquivo, uma consulta que POSSA
 * retornar uma versão antiga. Não há um `.eq("status", "active")` aqui para
 * alguém esquecer de escrever — não há consulta nenhuma.
 *
 * ⚠️ E ISSO É O §27 ("não duplicar conteúdo") APLICADO À LÓGICA, e não só aos
 * arquivos. A tentação óbvia era escrever aqui um `getBolsaParaFluxo()` — mais
 * direto, devolveria exatamente as variáveis que o fluxo quer, sem passar pelo
 * formato do robô de um turno. E a partir daí existiriam DUAS respostas para
 * "qual boletim está publicado": a do robô e a do fluxo. Elas concordariam no
 * primeiro dia. A segunda envelheceria calada — porque quem mudasse a regra de
 * publicação mexeria no lugar que conhece, e o outro continuaria mandando o
 * PDF do mês passado sem nada falhar.
 *
 * Uma camada a mais de indireção é o preço de haver uma verdade só.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ O QUE ESTÁ FALTANDO AQUI, E POR QUE FALTAR É A RESPOSTA CERTA
 * ----------------------------------------------------------------------------
 * Quatro ações do registro continuam SEM handler, e nenhuma por esquecimento:
 *
 *   `solicitar_palestra`   `createLectureRequest` exige nome, cidade, tipo,
 *                          tema e DATA DO EVENTO. Um fluxo consegue coletar
 *                          isso — são cinco nós de pergunta —, mas o registro
 *                          hoje declara três parâmetros. Ligar o handler com a
 *                          lista errada faria a publicação aceitar um fluxo que
 *                          falha em execução, na frente da pessoa.
 *
 *   `participar_enquete`   `registerSurveyResponse` precisa de `surveyId` e
 *                          `optionId`. O fluxo não tem de onde tirá-los: quem
 *                          sabe qual enquete está aberta para aquele contato é
 *                          `survey-inbox.ts`, que roda ANTES do fluxo na fila
 *                          de consumidores e já trata o voto. Inventar um id
 *                          aqui seria o hardcode que o §51 proíbe.
 *
 *   `registrar_lead`       `src/lib/services/leads.ts` só LÊ (é a caixa do CSP).
 *                          Não existe porta de escrita para delegar, e criar
 *                          uma dentro deste arquivo seria a arquitetura
 *                          paralela do §51.
 *
 *   `criar_ticket`         não há módulo de chamados. O caminho para uma pessoa
 *                          é o nó ATTENDANT, que já funciona.
 *
 * ⚠️ E O ESTADO "SEM HANDLER" É SEGURO POR CONSTRUÇÃO: `isFlowActionReady`
 * devolve `false`, e `flow.rules.ts` RECUSA PUBLICAR um fluxo que dependa
 * dessas ações, com uma frase dizendo qual falta. Ou seja, o desenhador
 * descobre no botão de publicar — e não o associado, no meio do atendimento.
 * Ligar qualquer uma delas continua sendo uma entrada aqui.
 */

/* -------------------------------------------------------------------------- */
/* O contexto que a ferramenta espera                                         */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ QUEM ESTÁ FALANDO SAI DO BANCO, E NÃO DAS VARIÁVEIS DO FLUXO — é o §37 do
 * Prompt 3 ("nunca confiar em id vindo do frontend") e o §48 deste.
 *
 * O caminho tentador era ler `variables["telefone"]`, que o fluxo pode ter
 * coletado numa pergunta. Isso deixaria uma pessoa digitar o telefone de OUTRO
 * associado e receber a agenda de eventos dele — a agenda é segmentada por
 * público, então seria vazamento de verdade, por um campo de texto livre.
 *
 * `getBotChatTarget` lê pelo id da conversa que o próprio webhook gravou. Não há
 * caminho, deste lado, em que um número digitado vire identidade.
 */
async function contextoDaConversa(
  entrada: FlowActionInput,
  pergunta: string,
): Promise<ToolContext & { contactId: string | null }> {
  const alvo = entrada.whatsappChatId ? await getBotChatTarget(entrada.whatsappChatId) : null;

  return {
    message: pergunta,
    memberId: alvo?.memberId ?? null,
    phone: alvo?.phone ?? null,
    contactId: alvo?.contactId ?? null,
    // A trilha do fluxo tem `runId`; a da ferramenta pede um `correlationId`. A
    // chave do passo é o que os dois lados conseguem cruzar sem inventar um id
    // novo — ela já identifica exatamente esta execução deste nó.
    correlationId: entrada.idempotencyKey,
  };
}

/** O primeiro argumento preenchido, para as ferramentas que pedem um assunto. */
function primeiro(variables: Readonly<Record<string, string>>, nomes: string[]): string | null {
  for (const nome of nomes) {
    const valor = variables[nome]?.trim();
    if (valor) return valor;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* A tradução ferramenta → ação                                               */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ OS QUATRO DESFECHOS DA FERRAMENTA NÃO COLAPSAM EM DOIS, e manter os quatro
 * separados é o que o desenho precisa para dizer coisas diferentes:
 *
 *   `ok`            veio conteúdo   → `success`, e as variáveis entram
 *   `empty`         consultou e não há publicação vigente → `not_found`.
 *                   NÃO É FALHA: é a APCS não ter o que mandar agora, e a
 *                   resposta certa fala de publicação, não de erro.
 *   `unidentified`  a resposta depende de saber quem é, e o telefone não está
 *                   no cadastro → `not_found` COM contexto (ver abaixo)
 *   `error`         a consulta falhou de verdade → `retry`
 *
 * ⚠️ `error` VIRA `retry`, E NÃO `error`. A ferramenta captura QUALQUER exceção
 * num `status: "error"` só — de onde não dá para distinguir "o Supabase piscou"
 * de "há um defeito no código". Como o teto de tentativas de um nó de ação é 1
 * por padrão (`actionNodeConfigSchema`), mapear para `retry` NÃO faz o sistema
 * insistir sozinho: ele só permite que o desenhador PEÇA a insistência no nó
 * onde ela vale. Mapeando para `error`, essa escolha deixaria de existir — e a
 * causa dominante na prática (indisponibilidade momentânea) é justamente a que
 * melhora com uma segunda tentativa.
 */
function traduzir(
  resultado: ToolResult,
  variaveis: (r: Extract<ToolResult, { status: "ok" }>) => Record<string, string>,
): FlowActionOutput {
  switch (resultado.status) {
    case "ok":
      return { ok: true, variables: variaveis(resultado) };
    case "empty":
      return { ok: false, reason: "empty" };
    case "unidentified":
      // Ver o campo `variables` do ramo de fracasso em `FlowActionOutput`: é
      // isto que deixa o desenho responder "não encontrei este número no
      // cadastro" em vez de "não há eventos" — que seria mentira sobre a agenda.
      return { ok: false, reason: "empty", variables: { motivo: "nao_identificado" } };
    default:
      return { ok: false, reason: "retry" };
  }
}

/** O anexo de um tipo, quando a ferramenta trouxe um. */
function anexo(
  resultado: Extract<ToolResult, { status: "ok" }>,
  kind: "image" | "document",
): string {
  return resultado.attachments.find((a) => a.kind === kind)?.url ?? "";
}

/**
 * O molde das cinco consultas: chama a ferramenta, traduz o desfecho.
 *
 * `assunto` é o que a ferramenta recebe como `subject`; `pergunta` é a mensagem
 * inteira, que só a Base de Conhecimento usa (ela casa PALAVRAS-CHAVE com o que
 * a pessoa escreveu — ver o aviso em `tools.ts::getKnowledge`).
 */
function consulta(
  tool: ToolName,
  campos: { assunto: string[]; pergunta: string[] },
  variaveis: (r: Extract<ToolResult, { status: "ok" }>) => Record<string, string>,
): FlowActionHandler {
  return async (entrada) => {
    const pergunta = primeiro(entrada.variables, campos.pergunta) ?? "";
    const contexto = await contextoDaConversa(entrada, pergunta);
    const assunto = primeiro(entrada.variables, campos.assunto);

    const resultado = await toolFor(tool).run(assunto, contexto);
    return traduzir(resultado, variaveis);
  };
}

/**
 * ⚠️ `sys_intent_subject` ENTRA EM TODA LISTA DE ASSUNTO, e é o que fecha a
 * corrente do §46: a pessoa escreve "quero a normativa da Câmara Ambiental", a
 * IA devolve `subject = "Câmara Ambiental"`, isso vira `sys_intent_subject`, e a
 * Action procura por ele SEM ninguém ter desenhado uma pergunta pedindo o
 * assunto.
 *
 * ⚠️ MAS ELE VEM POR ÚLTIMO. Uma variável que o fluxo coletou numa PERGUNTA é
 * mais confiável que a leitura de um modelo: ela é o que a pessoa respondeu
 * quando lhe perguntaram diretamente. A ordem desta lista é a ordem da
 * preferência — ver `primeiro`.
 */
const ASSUNTO = ["assunto", "sys_intent_subject"];
const PERGUNTA = ["pergunta", "sys_intent_subject"];

/* -------------------------------------------------------------------------- */
/* §17 a §26 — as consultas                                                   */
/* -------------------------------------------------------------------------- */

/**
 * §17, §18, §19. A BOLSA.
 *
 * ⚠️ AS DUAS URLS SAEM SEPARADAS, e é o §19 inteiro. A ferramenta devolve os
 * dois anexos (imagem e PDF, nessa ordem — a imagem é o que a pessoa lê no
 * celular sem abrir nada); o fluxo recebe os dois como variáveis e o desenhador
 * decide o que fazer com cada uma, tipicamente dois nós de mensagem em sequência
 * com `{{bolsa_imagem_url}}` e `{{bolsa_pdf_url}}`.
 *
 * Um campo só, "o anexo", obrigaria o motor a escolher qual mandar — e a
 * escolha certa depende do fluxo, não do motor.
 */
const consultarBolsa = consulta(
  "getActiveBolsa",
  { assunto: ASSUNTO, pergunta: PERGUNTA },
  (r) => ({
    bolsa_titulo: r.body,
    bolsa_imagem_url: anexo(r, "image"),
    bolsa_pdf_url: anexo(r, "document"),
    // ⚠️ MANTIDO POR COMPATIBILIDADE com os fluxos que já citam `bolsa_url`, e
    // apontando para o PDF — que é o que "o arquivo da Bolsa" significava antes
    // de a imagem existir como variável própria.
    bolsa_url: anexo(r, "document"),
  }),
);

/** §20, §21. As normativas. A versão ATIVA, sempre — a regra está no serviço. */
const consultarNormativa = consulta(
  "getActiveNormativa",
  { assunto: ASSUNTO, pergunta: PERGUNTA },
  (r) => ({
    normativa_titulo: r.body,
    normativa_url: anexo(r, "document"),
  }),
);

/** §22. ISP, revista, calendário, custo de produção — a mesma porta documental. */
const consultarComunicacao = consulta(
  "getActiveComunicacao",
  { assunto: ASSUNTO, pergunta: PERGUNTA },
  (r) => ({
    comunicado_titulo: r.body,
    comunicado_url: anexo(r, "document"),
  }),
);

/**
 * §23. A AGENDA.
 *
 * ⚠️ ELA DEVOLVE UMA LISTA JÁ ESCRITA, e não um evento. É a única das cinco
 * assim, e o registro precisou dizer isso (`produces`): a ferramenta monta o
 * texto com nome, data e local de CADA evento do público daquela pessoa.
 *
 * Escolher um deles para virar `evento_titulo` seria inventar uma preferência
 * que ninguém expressou. Quem quiser um evento específico faz uma pergunta
 * depois da lista — que é conversa, e conversa é desenho.
 */
const consultarEvento = consulta(
  "getActiveEvents",
  { assunto: ASSUNTO, pergunta: PERGUNTA },
  (r) => ({ evento_lista: r.body }),
);

/**
 * §26. A BASE DE CONHECIMENTO.
 *
 * ⚠️ ELA RECEBE A PERGUNTA INTEIRA, e não o assunto — é a única assim. A busca
 * casa PALAVRAS-CHAVE com o que a pessoa escreveu: "vocês abrem que horas?" não
 * tem assunto extraível, tem "horas", que é justamente a chave cadastrada.
 * Passar só o assunto aqui jogaria fora o que faz a busca funcionar. Ver o
 * comentário em `tools.ts::getKnowledge`, que registra a vez em que isso deu
 * errado de verdade.
 *
 * ⚠️ E O TEXTO SAI COMO ESTÁ ESCRITO. Nada resume, reescreve ou combina dois
 * itens — é o §43: a resposta oficial é a da APCS, e a IA só ajudou a entender
 * a pergunta.
 */
const consultarConhecimento = consulta(
  "getKnowledge",
  { assunto: ASSUNTO, pergunta: PERGUNTA },
  (r) => ({ conhecimento_resposta: r.body }),
);

/**
 * §24. O ANDAMENTO DE UMA SOLICITAÇÃO DE PALESTRA.
 *
 * ⚠️ ELA NÃO USA `toolFor`, porque não existe ferramenta para isso — o robô de
 * um turno nunca precisou dela. Vai direto à porta de chatbot do módulo
 * (`lecture-chatbot.ts`), que é a mesma camada onde as outras cinco terminam.
 * O §24 diz "utilizar os dados do módulo de Palestras existente. Não criar um
 * segundo cadastro", e é o que isto faz.
 *
 * ⚠️ E ELA EXIGE O CONTATO DA CONVERSA. `getLectureRequestByProtocol` só devolve
 * a solicitação se ela for DAQUELE contato — é o §48 ("cliente não acessa dados
 * de outro cliente"). Um protocolo é uma sequência curta e adivinhável; sem o
 * pareamento, quem chutasse "APCS-0042" leria o pedido de outra pessoa, com
 * nome, cidade e tema.
 */
const consultarPalestra: FlowActionHandler = async (entrada) => {
  const protocolo = primeiro(entrada.variables, ["protocolo"]);
  if (!protocolo) return { ok: false, reason: "error" };

  const contexto = await contextoDaConversa(entrada, protocolo);
  if (!contexto.contactId) {
    // Sem contato conhecido não há como pareá-lo com a solicitação — e o
    // desfecho honesto é o mesmo do robô de um turno: não é "não existe", é
    // "não sei quem você é".
    return { ok: false, reason: "empty", variables: { motivo: "nao_identificado" } };
  }

  const resultado = await getLectureRequestByProtocol(protocolo, contexto.contactId);
  if (resultado.status !== "found") return { ok: false, reason: "empty" };

  // A anotação é necessária: sem ela o TypeScript infere a UNIÃO de todos os
  // retornos deste handler e conclui que `palestra_protocolo` pode ser
  // `undefined` no ramo de fracasso — que declara `motivo` e mais nada.
  const variables: Record<string, string> = {
    palestra_protocolo: resultado.lecture.protocol,
    // O rótulo em PT-BR já vem pronto do módulo: o robô não traduz enum.
    palestra_situacao: resultado.lecture.statusLabel,
    palestra_situacao_detalhe: resultado.lecture.statusHint,
    palestra_tema: resultado.lecture.theme,
    palestra_cidade: resultado.lecture.city,
    palestra_data: resultado.lecture.eventDate,
  };

  return { ok: true, variables };
};

/* -------------------------------------------------------------------------- */
/* O registro                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ ESTE MÓDULO TEM EFEITO COLATERAL AO SER IMPORTADO, e isso é deliberado.
 *
 * `FLOW_ACTION_HANDLERS` é um objeto do módulo de domínio (`src/modules/`), que
 * é PURO — ele não pode importar `server-only`, nem um serviço, nem o cliente
 * do Supabase. Se a ligação morasse lá, o módulo puro deixaria de ser puro e o
 * simulador do Builder (que roda o mesmo motor sem banco) pararia de compilar.
 *
 * Então a inversão: o registro declara o CONTRATO e fica vazio; este arquivo,
 * que já é `server-only`, o preenche. Quem garante que ele seja carregado antes
 * do primeiro turno é o import em `lib/flow/runtime.ts` — ver o aviso lá.
 *
 * ⚠️ E O `void` NÃO É ENFEITE: sem uma referência exportada, o bundler pode
 * concluir que o import só tem efeito colateral e removê-lo em produção. O
 * arquivo sumiria do build, os handlers não seriam registrados, e todo fluxo
 * com ação falharia com "ação sem handler ligado" — em produção, e não em
 * desenvolvimento.
 */
Object.assign(FLOW_ACTION_HANDLERS, {
  consultar_bolsa: consultarBolsa,
  consultar_normativa: consultarNormativa,
  consultar_comunicacao: consultarComunicacao,
  consultar_evento: consultarEvento,
  consultar_conhecimento: consultarConhecimento,
  consultar_palestra: consultarPalestra,
});

/** A âncora que impede o import de ser podado. Ver o aviso acima. */
export const FLOW_ACTION_HANDLERS_LOADED = true;
