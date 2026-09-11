import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { messagingProvider } from "@/lib/messaging/registry";
import { maskPhone, toWhatsAppNumber } from "@/lib/messaging/phone";
import { DEFAULT_MESSAGES_PER_SECOND, throttleDelayMs } from "@/lib/messaging/resilience";
import { logEvaluationDispatch, newCorrelationId } from "@/lib/messaging/telemetry";
import { SETTING_KEYS } from "@/modules/admin/admin.labels";
import { EVALUATION_INVITE_FALLBACK } from "@/modules/event/event.evaluation.labels";
import {
  publicEvaluationPath,
  renderEvaluationInvite,
} from "@/modules/event/event.evaluation.rules";
import { formatCalendarDate } from "@/lib/utils";
import type { MessagingProvider } from "@/lib/messaging/messaging.types";

/**
 * O WORKER DA AVALIAÇÃO DE EVENTO (§12, §14, §15, §16).
 *
 *     evento termina + atraso → schedule → [ este arquivo ] → Z-API
 *
 * ============================================================================
 * ⚠️ A CAMADA DO MEIO DO §12, E ELA É ESTE ARQUIVO.
 * ============================================================================
 * O escopo desenha `EvaluationService → EvaluationNotificationService →
 * WhatsAppProvider` e manda não acoplar a avaliação a um fornecedor. A
 * plataforma já tem essa separação pronta: `MessagingProvider`
 * (src/lib/messaging/messaging.types.ts) é a porta, e a Z-API e a Cloud API da
 * Meta são adaptadores dela.
 *
 * Então este arquivo sabe o que é uma avaliação e o que é uma fila; NÃO sabe o
 * que é um header `Client-Token`, um erro 429 ou o formato de payload de
 * ninguém. Trocar de fornecedor não encosta aqui.
 *
 * ============================================================================
 * ⚠️ POR QUE A FILA É PUXADA POR CICLO, E NÃO UM `for` QUE PERCORRE TUDO
 * ============================================================================
 * É a mesma razão de Enquetes e da divulgação de Eventos, e ela não mudou:
 * nenhuma função serverless vive o tempo de mandar mil mensagens a cinco por
 * segundo. Cada execução tem ORÇAMENTO, manda o que couber e termina. O que
 * sobrou continua na fila, e a próxima execução pega de onde parou.
 *
 * **Interromper no meio é o funcionamento normal, não uma falha.**
 *
 * ============================================================================
 * ⚠️ O QUE ESTE ARQUIVO NÃO DECIDE: QUEM RECEBE
 * ============================================================================
 * A elegibilidade do §11 — só quem esteve PRESENTE — mora inteira em
 * `schedule_event_evaluations`, no banco. Aqui não há um `if (present)` para
 * alguém esquecer de copiar: quando uma linha chega a este arquivo, ela já
 * passou por aquele filtro. É a mesma disciplina de `set_participant_presence`
 * no Prompt 1 — a regra num lugar só, no lugar mais difícil de contornar.
 */

/** §15. Quantos eventos uma passada agenda. Os demais ficam para a seguinte. */
const MAX_EVENTS_PER_TICK = 5;

/** Lote reivindicado por vez. Ver `claim_event_evaluations`. */
const BATCH_SIZE = 25;

/**
 * Orçamento de uma execução.
 *
 * O teto de tempo é o que impede a função de ser morta pela plataforma NO MEIO
 * de um envio — o que deixaria uma linha com a mensagem entregue e sem carimbo.
 * 40s cabe folgado no `maxDuration` de 60s da rota.
 */
const RUN_BUDGET_MS = 40_000;

export interface EvaluationDispatchOutcome {
  /** Quantas avaliações a rotina CRIOU nesta passada (§14). */
  created: number;
  /** Quantos eventos entraram na conta acima. */
  events: number;
  /** Quantas passaram do prazo (§20). */
  expired: number;
  /**
   * §5 e §14 do Prompt 4. Eventos que venceram a hora e foram ignorados, com o
   * motivo — "processado, 0 presentes, 0 envios" precisa aparecer em algum
   * lugar, e este é o lugar.
   */
  skippedNoPresent: number;
  skippedNoQuestions: number;
  claimed: number;
  sent: number;
  errors: number;
  /** Quem não recebeu por telefone inválido — não é falha de envio. */
  ineligible: number;
  /**
   * §22 do Prompt 4. Convites barrados porque o TEXTO está sem
   * `{{link_avaliacao}}`. Não é falha de envio nem telefone ruim: é
   * configuração, e a providência é abrir Textos e LGPD.
   */
  misconfigured: number;
  /**
   * Mensagens que SAÍRAM e cujo resultado não pôde ser gravado.
   *
   * ⚠️ ESTE É O NÚMERO MAIS PERIGOSO DESTE ARQUIVO. A pessoa recebeu, a linha
   * continua na fila, e dez minutos depois o arrendamento a devolve como se
   * nada tivesse acontecido — e a próxima corrida manda de novo. Ele existe
   * para que isso seja VISÍVEL na resposta da rotina, em vez de virar uma
   * reclamação de mensagem repetida semanas depois.
   */
  unsettled: number;
  providerConfigured: boolean;
  correlationId: string;
}

interface LinhaDaFila {
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

/**
 * Uma passada completa (§14).
 *
 * A ordem não é arbitrária:
 *
 *   1. EXPIRA o que passou do prazo — antes de reivindicar, para não mandar
 *      convite de avaliação que já não aceita resposta;
 *   2. AGENDA quem tem direito — antes de enviar, senão quem acabou de ficar
 *      elegível só sairia na passada seguinte;
 *   3. ENVIA o que estiver na fila.
 *
 * ⚠️ OS PASSOS 1 E 2 ACONTECEM MESMO SEM FORNECEDOR CONFIGURADO. Expirar e
 * agendar são promessas do banco que não dependem de WhatsApp nenhum — e a tela
 * de Avaliações precisa dizer a verdade sobre o andamento mesmo numa instalação
 * sem integração de mensageria. É o mesmo desenho de `runSurveyTick`.
 */
export async function runEventEvaluationTick(
  origin: string,
  provider: MessagingProvider = messagingProvider(),
): Promise<EvaluationDispatchOutcome> {
  const correlationId = newCorrelationId();
  const admin = createAdminClient();

  const resultado: EvaluationDispatchOutcome = {
    created: 0,
    events: 0,
    expired: 0,
    skippedNoPresent: 0,
    skippedNoQuestions: 0,
    claimed: 0,
    sent: 0,
    errors: 0,
    ineligible: 0,
    misconfigured: 0,
    unsettled: 0,
    providerConfigured: provider.configured,
    correlationId,
  };

  const { data: expiradas, error: erroExpira } = await admin.rpc("expire_event_evaluations");
  if (erroExpira) {
    logEvaluationDispatch("error", "tick.skipped", {
      correlationId,
      reason: `expire falhou: ${erroExpira.code}`,
    });
  } else {
    resultado.expired = typeof expiradas === "number" ? expiradas : 0;
  }

  const { data: agendadas, error: erroAgenda } = await admin.rpc("schedule_event_evaluations", {
    p_limit: MAX_EVENTS_PER_TICK,
  });
  if (erroAgenda) {
    logEvaluationDispatch("error", "tick.skipped", {
      correlationId,
      reason: `schedule falhou: ${erroAgenda.code}`,
    });
  } else if (agendadas && typeof agendadas === "object") {
    const bruto = agendadas as {
      created?: unknown;
      events?: unknown;
      skippedNoPresent?: unknown;
      skippedNoQuestions?: unknown;
    };
    resultado.created = typeof bruto.created === "number" ? bruto.created : 0;
    resultado.events = typeof bruto.events === "number" ? bruto.events : 0;
    resultado.skippedNoPresent =
      typeof bruto.skippedNoPresent === "number" ? bruto.skippedNoPresent : 0;
    resultado.skippedNoQuestions =
      typeof bruto.skippedNoQuestions === "number" ? bruto.skippedNoQuestions : 0;
  }

  // §5/§14. "Evento processado / Presentes: 0 / Avaliações geradas: 0" — o
  // evento sem presentes deixou de ser descartado em silêncio.
  logEvaluationDispatch("info", "schedule.done", {
    correlationId,
    outcome:
      `eventos=${resultado.events} criadas=${resultado.created} ` +
      `expiradas=${resultado.expired} ` +
      `ignorados_sem_presente=${resultado.skippedNoPresent} ` +
      `ignorados_sem_pergunta=${resultado.skippedNoQuestions}`,
  });

  if (!provider.configured) {
    logEvaluationDispatch("info", "tick.skipped", {
      correlationId,
      reason: `fornecedor não configurado: ${provider.missing.join(", ")}`,
    });
    return resultado;
  }

  const template = await lerConvite(admin);

  const inicio = Date.now();
  const intervalo = throttleDelayMs(DEFAULT_MESSAGES_PER_SECOND);

  while (Date.now() - inicio < RUN_BUDGET_MS) {
    const lote = await reivindicar(admin, BATCH_SIZE, correlationId);
    if (lote.length === 0) break;

    resultado.claimed += lote.length;

    for (const linha of lote) {
      if (Date.now() - inicio >= RUN_BUDGET_MS) break;

      await enviarUma(linha, {
        admin,
        provider,
        template,
        origin,
        correlationId,
        resultado,
      });

      // O acelerador existe para não estourar a cota do fornecedor. Ele fica
      // DEPOIS do envio, e não antes, para a primeira mensagem não esperar.
      if (intervalo > 0) await dormir(intervalo);
    }
  }

  logEvaluationDispatch("info", "tick.finished", {
    correlationId,
    outcome:
      `enviadas=${resultado.sent} erros=${resultado.errors} ` +
      `inelegiveis=${resultado.ineligible} config=${resultado.misconfigured} ` +
      `sem_carimbo=${resultado.unsettled}`,
  });

  return resultado;
}

/**
 * O texto do convite (§13).
 *
 * ⚠️ LIDO UMA VEZ POR CORRIDA, e não uma por pessoa. São até 300 mensagens
 * lendo a mesma linha de uma tabela minúscula — e, pior, uma edição no meio da
 * corrida faria metade das pessoas receber um texto e metade outro.
 *
 * ⚠️ `createAdminClient` E NÃO `getAppSettings`, porque aqui não há sessão:
 * quem chama é o cron. `app_settings` tem RLS, e a leitura autenticada devolve
 * vazio — o que faria TODO convite cair no padrão do código sem ninguém
 * perceber, exatamente o defeito que `loadChatbotMessages` documenta.
 *
 * ⚠️ E FALHAR AQUI NÃO CANCELA O ENVIO. O padrão do código é a rede de
 * segurança: um convite com o texto da casa é melhor que nenhum convite, e
 * bem melhor que uma mensagem vazia (que o WhatsApp nem entrega).
 */
async function lerConvite(admin: ReturnType<typeof createAdminClient>): Promise<string> {
  try {
    const { data, error } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", SETTING_KEYS.eventEvaluationInvite)
      // Hint de tipo (descompasso de generics ssr/supabase-js). Ver CONVENTIONS.md.
      .returns<{ value: string }[]>();

    if (error) throw error;
    const gravado = data?.[0]?.value?.trim();
    if (gravado) return gravado;
  } catch (erro) {
    console.error(
      `[event-evaluation] convite: leitura falhou, usando o padrão do código: ${
        erro instanceof Error ? erro.message : String(erro)
      }`,
    );
  }

  return EVALUATION_INVITE_FALLBACK;
}

async function reivindicar(
  admin: ReturnType<typeof createAdminClient>,
  limite: number,
  correlationId: string,
): Promise<LinhaDaFila[]> {
  const { data, error } = await admin.rpc("claim_event_evaluations", { p_limit: limite });

  if (error) {
    logEvaluationDispatch("error", "tick.skipped", {
      correlationId,
      reason: `claim falhou: ${error.code}`,
    });
    return [];
  }

  return Array.isArray(data) ? (data as unknown as LinhaDaFila[]) : [];
}

interface ContextoDeEnvio {
  admin: ReturnType<typeof createAdminClient>;
  provider: MessagingProvider;
  template: string;
  origin: string;
  correlationId: string;
  resultado: EvaluationDispatchOutcome;
}

async function enviarUma(linha: LinhaDaFila, ctx: ContextoDeEnvio): Promise<void> {
  const { admin, provider, template, origin, correlationId, resultado } = ctx;

  /**
   * ⚠️ WHATSAPP PRIMEIRO, TELEFONE DEPOIS. `event_participants` tem os dois e o
   * §8 do Prompt 1 garante que pelo menos um existe. O campo WhatsApp é o que a
   * pessoa declarou como sendo o número do aplicativo; o `phone` costuma ser o
   * fixo da granja, e mandar mensagem para um fixo é uma falha certa que ainda
   * assim queima uma tentativa.
   */
  const numero = toWhatsAppNumber(linha.whatsapp ?? linha.phone);

  if (!numero.ok) {
    /**
     * ⚠️ TELEFONE INVÁLIDO NÃO É FALHA DE ENVIO, e a diferença importa: uma
     * falha volta para a fila e é tentada de novo; um número que não existe
     * nunca vai funcionar, e insistir queima tentativa a cada passada até
     * estourar o teto.
     *
     * A linha é marcada com o motivo e sai da fila pelo caminho normal (as
     * tentativas se esgotam), e a tela mostra o erro para quem puder corrigir o
     * cadastro e reenviar.
     */
    resultado.ineligible += 1;
    await admin.rpc("mark_event_evaluation_failed", {
      p_id: linha.id,
      p_error: `telefone inválido: ${numero.reason}`,
    });
    logEvaluationDispatch("info", "send.ineligible", {
      correlationId,
      recipientId: linha.id,
      reason: numero.reason,
    });
    return;
  }

  // ⚠️ O ENDEREÇO ABSOLUTO, porque o destino é o WhatsApp e não o navegador de
  // quem já está no sistema. Um caminho relativo chegaria como texto.
  const link = `${origin}${publicEvaluationPath(linha.token)}`;

  const corpo = renderEvaluationInvite(template, {
    nome: primeiroNome(linha.fullName),
    evento: linha.eventName,
    dataEvento: formatCalendarDate(linha.eventDate),
    link,
  });

  /**
   * ⚠️ §22 DO PROMPT 4 — MENSAGEM SEM LINK NÃO SAI.
   *
   * "Se alguma variável não existir: não enviar mensagem quebrada. Registrar
   * erro de configuração."
   *
   * O texto do convite é editável em Configurações → Textos e LGPD, e
   * `renderEvaluationInvite` troca o que reconhece e deixa o resto literal — de
   * propósito, para uma variável mal escrita ser visível. Mas apagar
   * `{{link_avaliacao}}` não deixa nada visível: produz um convite educado,
   * perfeitamente legível, e sem endereço nenhum.
   *
   * ⚠️ E O ESTRAGO SERIA SILENCIOSO E CARO. O fornecedor aceita a mensagem, o
   * carimbo entra, a tela diz "Enviada", e trezentas pessoas recebem um convite
   * para responder algo que não têm como abrir. Ninguém descobre até a taxa de
   * resposta fechar em zero.
   *
   * ⚠️ POR QUE ISTO É CONFIGURAÇÃO, E NÃO FALHA DE ENVIO. `mark_event_evaluation_failed`
   * mantém a linha na fila e a próxima passada tenta de novo — o certo, porque
   * consertar o texto conserta todo mundo de uma vez. O que muda é o motivo
   * registrado: ele aponta para a TELA DE TEXTOS, e não para o telefone da
   * pessoa.
   */
  if (!corpo.includes(link)) {
    resultado.misconfigured += 1;
    await admin.rpc("mark_event_evaluation_failed", {
      p_id: linha.id,
      p_error:
        "o texto do convite não contém {{link_avaliacao}} — corrija em Configurações → Textos e LGPD",
    });
    logEvaluationDispatch("error", "send.misconfigured", {
      correlationId,
      recipientId: linha.id,
      reason: "convite sem {{link_avaliacao}}",
    });
    return;
  }

  const envio = await provider.send({ to: numero.e164, body: corpo, correlationId });

  if (!envio.ok) {
    resultado.errors += 1;
    await admin.rpc("mark_event_evaluation_failed", {
      p_id: linha.id,
      p_error: `${envio.code}: ${envio.message}`,
    });
    logEvaluationDispatch("error", "send.error", {
      correlationId,
      recipientId: linha.id,
      reason: envio.code,
      attempt: linha.attempts,
      // ⚠️ MASCARADO, SEMPRE. O log é um caminho que ninguém audita, e telefone
      // de terceiro que entra nele não sai.
      phone: maskPhone(numero.e164),
    });
    return;
  }

  const { error: erroCarimbo } = await admin.rpc("mark_event_evaluation_sent", {
    p_id: linha.id,
    p_provider_message_id: envio.providerMessageId,
  });

  if (erroCarimbo) {
    /**
     * ⚠️ A MENSAGEM SAIU E O CARIMBO NÃO ENTROU. É o caso descrito em
     * `unsettled`: a pessoa recebeu, e daqui a dez minutos o arrendamento
     * devolve a linha para a fila como se nada tivesse acontecido.
     *
     * Não há o que fazer aqui além de CONTAR e registrar — tentar de novo
     * gravar tem a mesma chance de falhar pelo mesmo motivo, e desfazer o envio
     * é impossível. O número aparece na resposta da rotina, que é onde alguém
     * consegue vê-lo.
     */
    resultado.unsettled += 1;
    // ⚠️ EVENTO PRÓPRIO, e não `send.error`. Um erro de envio significa que a
    // pessoa NÃO recebeu; este significa que ela recebeu e nós não sabemos
    // disso. Confundir os dois no log faria a investigação procurar uma
    // mensagem que não saiu — quando o problema é uma que saiu duas vezes.
    logEvaluationDispatch("error", "send.unsettled", {
      correlationId,
      recipientId: linha.id,
      providerMessageId: envio.providerMessageId,
      reason: `enviada sem carimbo: ${erroCarimbo.code}`,
    });
    return;
  }

  resultado.sent += 1;
  logEvaluationDispatch("info", "send.ok", {
    correlationId,
    recipientId: linha.id,
    providerMessageId: envio.providerMessageId,
    phone: maskPhone(numero.e164),
  });
}

/**
 * "João da Silva" → "João".
 *
 * ⚠️ O MESMO CORTE DA PÁGINA PÚBLICA, e de propósito: a pessoa recebe "Olá,
 * João!" no WhatsApp e lê "Olá, João!" ao abrir o link. Nomes diferentes nos
 * dois lugares fariam parecer que uma das duas coisas é de outra pessoa.
 */
function primeiroNome(nomeCompleto: string): string {
  return nomeCompleto.trim().split(/\s+/)[0] ?? nomeCompleto;
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
