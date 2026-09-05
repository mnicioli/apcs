import "server-only";
import { maskPhone } from "@/lib/messaging/phone";
import { logFlowEngineEvent } from "@/lib/messaging/telemetry";
import { handleInboundFlowMessage } from "@/lib/flow/runtime";
import { chatbotEnabled } from "@/lib/intelligence/flags";
import { botShouldAnswer, botWithinRateLimit } from "@/lib/services/whatsapp-bot";
import type { MessagingProvider } from "@/lib/messaging/messaging.types";
import type { RecordedMessage } from "@/lib/services/whatsapp-inbox";

/**
 * O FLUXO COMO CONSUMIDOR DO WEBHOOK — §4, §5, §6 e §39 do Prompt 4.
 *
 * ============================================================================
 * ONDE ELE ENTRA NA FILA, E POR QUÊ EXATAMENTE AÍ
 * ============================================================================
 *
 *     livro-razão  grava TUDO, sempre, antes de qualquer decisão
 *         ↓
 *     opt-out      quem pediu para sair não recebe mais nada          (§37)
 *         ↓
 *     enquetes     um "3" dentro de uma enquete é voto, não pergunta
 *         ↓
 *     FLUXO        ←── ESTE ARQUIVO
 *         ↓
 *     robô         o que sobrou: um turno, sem roteiro
 *
 * ⚠️ DEPOIS DO OPT-OUT E DAS ENQUETES, pelas razões que já valiam antes: quem
 * pediu para sair não recebe resposta nenhuma (o §37 não abre exceção para
 * fluxo), e quem está no meio de uma enquete está votando.
 *
 * ⚠️ ANTES DO ROBÔ DE UM TURNO, e esta é a decisão nova. O motivo é o §6: uma
 * conversa PARADA numa pergunta ("é sobre pagamento, cobrança ou outro
 * assunto?") tem de continuar de onde parou. Se o robô de um turno visse essa
 * mensagem primeiro, ele classificaria "cobrança" como uma pergunta nova, e
 * responderia alguma coisa sobre cobrança — abandonando a triagem no meio, com
 * as variáveis coletadas, sem nada falhar. A pessoa recomeçaria do zero sem
 * entender por quê.
 *
 * ============================================================================
 * ⚠️ E SEM FLUXO PUBLICADO, NADA MUDA. LEIA ISTO ANTES DE MEXER NA ORDEM.
 * ============================================================================
 *
 * `handleInboundFlowMessage` devolve `no_flow` quando não há fluxo de entrada
 * ATIVO com versão PUBLICADA para o canal — que é o estado de toda instalação
 * até alguém desenhar e publicar um. Nesse caso este consumidor não marca a
 * mensagem como tratada, e ela segue para o robô exatamente como seguia ontem.
 *
 * Isso é o que torna a mudança segura: ligar o Flow Engine não desliga nada. O
 * robô de um turno continua sendo o atendimento, e passa a ser o caminho de
 * quem NÃO está num fluxo — até que a APCS publique o primeiro. A migração é
 * uma decisão de produto tomada na tela de Fluxos, e não um deploy.
 *
 * ⚠️ NADA AQUI LANÇA PARA FORA. Uma exceção viraria 500 no webhook, o
 * fornecedor reentregaria o payload e o resultado seria um laço de reentrega
 * sobre um erro que não se resolve sozinho. Cada mensagem é tratada por conta
 * própria — é a mesma regra dos outros três consumidores.
 */

/**
 * Teto do que entra no motor.
 *
 * ⚠️ É O MESMO DE `intelligence-inbox.ts`, E PELA MESMA RAZÃO: o corpo da
 * mensagem é a única entrada deste sistema escrita por quem está do lado de
 * fora, e daqui ela pode viajar para um modelo. Um texto de cem mil caracteres
 * é um pedido de negação de serviço com aparência de pergunta. O corte preserva
 * o começo, que é onde a pergunta de verdade está.
 */
const MAX_MESSAGE_CHARS = 2000;

export interface FlowInboxOutcome {
  /** Avançaram no fluxo. */
  advanced: number;
  /** Não havia fluxo, ou a conversa não estava elegível. Vão para o robô. */
  skipped: number;
  failed: number;
  /**
   * Os eventos que O FLUXO consumiu — os que ele respondeu, descartou por
   * reentrega, por conflito ou por pausa.
   *
   * ⚠️ É O CAMPO QUE O WEBHOOK USA PARA NÃO ENTREGAR A MESMA MENSAGEM DUAS
   * VEZES, e é o mesmo contrato de `InboxOutcome.handled` e
   * `OptOutOutcome.handled`. Uma mensagem tratada aqui NÃO chega ao robô de um
   * turno: os dois respondendo a mesma pergunta mandariam duas respostas
   * diferentes para a mesma pessoa, no mesmo segundo.
   */
  handled: string[];
}

/**
 * §4. As mensagens que o fluxo pode atender.
 *
 * `handled` são os ids que os consumidores anteriores já consumiram.
 */
export async function processFlowMessages(
  messages: readonly RecordedMessage[],
  handled: ReadonlySet<string>,
  provider: MessagingProvider,
  correlationId: string,
): Promise<FlowInboxOutcome> {
  const resultado: FlowInboxOutcome = { advanced: 0, skipped: 0, failed: 0, handled: [] };

  if (!provider.configured) {
    // Sem fornecedor não há a quem responder. Recusar ANTES de mover o fluxo
    // evita o pior desfecho possível deste módulo: o estado avançar, a pergunta
    // seguinte ficar gravada como feita, e nada sair — a pessoa esperaria uma
    // mensagem que nunca foi enviada, num nó que ela nunca viu.
    logFlowEngineEvent("error", "flow.step_skipped", {
      correlationId,
      provider: provider.name,
      reason: "fornecedor nao configurado",
      count: messages.length,
    });
    return { ...resultado, skipped: messages.length };
  }

  /**
   * ⚠️ A CHAVE GERAL DO ROBÔ DESLIGA O FLUXO TAMBÉM, e ela é lida UMA VEZ POR
   * LOTE (o estado do interruptor não muda no meio de um punhado de eventos do
   * mesmo instante).
   *
   * A pergunta que decidiu isto: no dia em que o atendimento automático disser
   * algo errado, quem for desligá-lo às pressas vai procurar UM interruptor.
   * Dois — um para o robô, outro para os fluxos — significa que a pessoa
   * desliga um, vê o problema continuar e perde minutos com o sistema no ar
   * dizendo a coisa errada. Ver `chatbotEnabled`.
   *
   * As mensagens continuam sendo gravadas no livro-razão; o que se desliga é a
   * resposta automática, que é exatamente o que se quis desligar.
   */
  if (!(await chatbotEnabled())) {
    logFlowEngineEvent("info", "flow.step_skipped", {
      correlationId,
      reason: "atendimento automatico desligado na configuracao",
      count: messages.length,
    });
    return { ...resultado, skipped: messages.length };
  }

  for (const mensagem of messages) {
    const motivo = motivoParaPular(mensagem, handled);

    if (motivo) {
      resultado.skipped += 1;
      // ⚠️ NÃO ENTRA EM `handled`. Estas recusas são deste módulo, e não do
      // atendimento: uma mensagem sem texto não tem o que dar ao fluxo, mas o
      // robô de um turno pode ter o que fazer com ela. Marcá-la aqui a mataria
      // para os dois.
      continue;
    }

    try {
      const desfecho = await tratar(mensagem, provider, correlationId);

      if (desfecho === "skipped") {
        resultado.skipped += 1;
        continue;
      }

      // ⚠️ TUDO QUE NÃO É `skipped` É TRATADO, inclusive a falha e o conflito.
      //
      // Parece errado marcar uma falha como tratada, e não é. Uma execução que
      // falhou está NUM FLUXO: passar a mensagem ao robô de um turno o faria
      // responder por cima de uma triagem em andamento, com a conversa parada
      // num nó que ele desconhece. O certo é o silêncio — a conversa fica acesa
      // na caixa de entrada, que é onde uma PESSOA a vê.
      resultado.handled.push(mensagem.eventId);

      if (desfecho === "advanced") resultado.advanced += 1;
      else resultado.failed += 1;
    } catch (erro) {
      resultado.failed += 1;
      // ⚠️ A EXCEÇÃO NÃO MARCA COMO TRATADA. Aqui não se sabe se o fluxo chegou
      // a mover — e na dúvida, deixar o robô responder é melhor que a pessoa
      // ficar sem resposta nenhuma. É o inverso da escolha do parágrafo acima,
      // e a diferença é justamente saber ou não o que aconteceu.
      logFlowEngineEvent("error", "flow.failed", {
        correlationId,
        chatId: mensagem.chatId,
        reason: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  return resultado;
}

/**
 * As recusas que não precisam ir ao banco.
 *
 * ⚠️ SÃO AS MESMAS DE `intelligence-inbox.ts`, e a repetição é deliberada em vez
 * de extraída para um utilitário compartilhado. Elas parecem iguais e não são a
 * mesma regra: "mensagem só com anexo" aqui significa "o fluxo não tem o que
 * casar com alternativa nenhuma", e lá significa "não há o que classificar". No
 * dia em que o fluxo souber tratar um áudio (um nó de pergunta que aceita
 * mídia), esta lista encolhe e a outra não. Um helper comum faria as duas
 * mudarem juntas, e a segunda mudaria sem ninguém ter pedido.
 */
function motivoParaPular(mensagem: RecordedMessage, handled: ReadonlySet<string>): string | null {
  // §23. Reentrega do webhook. O livro-razão já sabia; aqui só se obedece.
  if (mensagem.duplicate) return "reentrega";

  // ⚠️ O QUE SAIU DO NOSSO NÚMERO NÃO É RESPOSTA DE NINGUÉM. Inclui o que o
  // próprio fluxo acabou de mandar: sem isto ele responderia à própria
  // pergunta, avançando o atendimento sozinho até o fim.
  if (mensagem.fromMe) return "saiu do nosso numero";

  if (mensagem.isGroup) return "grupo";

  if (handled.has(mensagem.eventId)) return "tratado por outro consumidor";

  // Uma foto ou um áudio não casam com alternativa nenhuma e não têm o que
  // interpretar. Passar adiante é o certo — ver o aviso sobre `handled`.
  if (mensagem.text.trim() === "") return "mensagem sem texto";

  return null;
}

type Desfecho = "advanced" | "skipped" | "failed";

async function tratar(
  mensagem: RecordedMessage,
  provider: MessagingProvider,
  correlationId: string,
): Promise<Desfecho> {
  /**
   * ⚠️ "DEVO FALAR?" VEM ANTES DE TUDO QUE CUSTA — grupo, silêncio em vigor e
   * ATENDIMENTO HUMANO ABERTO, os três numa consulta só.
   *
   * O terceiro é o §29 do Prompt 3 visto do outro lado: o motor tem a própria
   * pausa (`automation_paused_until`, que ELE grava ao transferir), e esta é a
   * pausa que um ATENDENTE cria ao assumir a conversa pelo CRM. As duas
   * precisam valer, porque nem toda conversa humana começou num fluxo — alguém
   * do time pode simplesmente abrir a caixa de entrada e responder.
   */
  if (!(await botShouldAnswer(mensagem.chatId))) {
    logFlowEngineEvent("info", "flow.paused", {
      correlationId,
      chatId: mensagem.chatId,
      reason: "conversa calada (atendimento humano ou pausa)",
    });
    // ⚠️ `skipped` E NÃO `handled`: a conversa está com uma pessoa, e o
    // consumidor seguinte tem a MESMA barreira (`botShouldAnswer`). Ele vai
    // recusar pelo mesmo motivo, e ninguém responde — que é o desejado.
    return "skipped";
  }

  /**
   * §39 do módulo de inteligência. O LIMITE DE USO.
   *
   * ⚠️ ESTOURAR É FICAR CALADO, e não avisar. Quem manda sete mensagens num
   * minuto não está esperando resposta — e uma frase automática de repreensão a
   * um associado é pior que o silêncio. A conversa continua acesa na aba "Não
   * lidas", que é onde uma PESSOA a vê.
   */
  if (!(await botWithinRateLimit(mensagem.chatId))) {
    logFlowEngineEvent("info", "flow.step_skipped", {
      correlationId,
      chatId: mensagem.chatId,
      reason: "limite de uso",
    });
    return "skipped";
  }

  const desfecho = await handleInboundFlowMessage({
    channel: "whatsapp",
    chatId: mensagem.chatId,
    text: mensagem.text.slice(0, MAX_MESSAGE_CHARS),
    // §23. A chave é o id do EVENTO no fornecedor, e não o da mensagem: é o
    // evento que é reentregue, e é ele que o livro-razão desduplica.
    idempotencyKey: mensagem.eventId,
    inboundMessageId: mensagem.messageId,
    provider,
    correlationId,
  });

  switch (desfecho.kind) {
    case "advanced":
      logFlowEngineEvent(desfecho.failed > 0 ? "error" : "info", "flow.node", {
        correlationId,
        runId: desfecho.runId,
        chatId: mensagem.chatId,
        count: desfecho.sent,
        phone: maskPhone(mensagem.phone),
      });
      return "advanced";

    case "no_flow":
      // O caso NORMAL até a APCS publicar o primeiro fluxo. Ver o aviso do topo:
      // a mensagem segue para o robô de um turno, como sempre seguiu.
      return "skipped";

    case "duplicate":
    case "conflict":
    case "paused":
      // ⚠️ OS TRÊS SÃO SILÊNCIO DELIBERADO, E CONTAM COMO TRATADOS.
      //
      //   `duplicate`  o passo já foi dado e as mensagens já saíram
      //   `conflict`   outra mensagem moveu a conversa; este turno foi
      //                descartado inteiro, sem nada ter sido enviado
      //   `paused`     uma pessoa assumiu
      //
      // Nos três, deixar o robô de um turno responder por cima seria atravessar
      // um atendimento em andamento.
      return "advanced";

    case "failed":
      logFlowEngineEvent("error", "flow.failed", {
        correlationId,
        runId: desfecho.runId,
        chatId: mensagem.chatId,
        reason: desfecho.reason,
        phone: maskPhone(mensagem.phone),
      });
      return "failed";
  }
}
