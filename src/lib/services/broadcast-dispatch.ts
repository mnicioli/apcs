import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { messagingProvider } from "@/lib/messaging/registry";
import { maskPhone, PHONE_REJECTION_REASONS, toWhatsAppNumber } from "@/lib/messaging/phone";
import {
  backoffDelayMs,
  CircuitBreaker,
  DEFAULT_MESSAGES_PER_SECOND,
  MAX_SEND_ATTEMPTS,
  throttleDelayMs,
} from "@/lib/messaging/resilience";
import { logBroadcast, newCorrelationId } from "@/lib/messaging/telemetry";
import type { MessagingProvider } from "@/lib/messaging/messaging.types";
import type { BroadcastRunOutcome } from "@/modules/broadcast/broadcast.types";

/**
 * O WORKER DA DIVULGAÇÃO GENÉRICA.
 *
 *     Action "Divulgar" → start_broadcast (fila) → [ este arquivo ] → Z-API
 *
 * ⚠️ É O MESMO DESENHO DE `event-dispatch.ts`, E ISSO É PROPOSITAL. Quem já leu
 * aquele arquivo entende este sem reaprender: mesmo orçamento por execução,
 * mesmo disjuntor, mesma cura de linhas presas, mesmas quatro categorias de
 * desfecho. O que muda é UMA coisa — este não sabe o que é um evento. Ele
 * recebe um texto pronto e, quando há, um anexo.
 *
 * ⚠️ POR QUE NÃO REUSAMOS `event-dispatch.ts` DIRETAMENTE. Ele fala com
 * `event_recipients`, `claim_event_recipients` e `finish_event_dispatch`, e
 * carrega regras de evento (data vencida, cartaz). Generalizá-lo significaria
 * mexer num arquivo em produção que hoje funciona, para servir a um caso que
 * ainda não existia. A duplicação aqui é de ESTRUTURA, não de regra: o filtro
 * de opt-out, a chave de telefone e o catálogo de públicos são os mesmos
 * objetos no banco, não cópias.
 *
 * ----------------------------------------------------------------------------
 * ⚠️ INTERROMPER NO MEIO É O FUNCIONAMENTO NORMAL
 * ----------------------------------------------------------------------------
 * Sem cron no projeto, cada execução tem orçamento de tempo e de quantidade.
 * Mil pessoas a 5 mensagens por segundo são três minutos e meio; nenhuma função
 * serverless vive tanto. O que sobrou continua `pending`, a tela diz quantos
 * faltam e oferece "Continuar".
 */

/** Lote reivindicado por vez. Ver `claim_broadcast_recipients`. */
const BATCH_SIZE = 25;

/**
 * Orçamento de uma execução. 45s cabe folgado no `maxDuration` de 60s da rota —
 * o teto existe para a plataforma não matar a função NO MEIO de um envio, o que
 * deixaria linhas presas em `sending` até a cura passar.
 */
const RUN_BUDGET_MS = 45_000;
const RUN_MAX_MESSAGES = 400;

/**
 * Validade da URL assinada do anexo.
 *
 * ⚠️ UMA HORA, para um orçamento de 45 SEGUNDOS — e a folga é o ponto. Quem
 * baixa o arquivo não somos nós: é o servidor da Z-API, quando ELE processa
 * cada envio, o que pode ser bem depois de a assinatura ter sido feita. Uma URL
 * curta demais expiraria no meio da fila e as últimas pessoas receberiam só o
 * texto — sem erro nenhum, que é a pior forma de falhar.
 */
const MEDIA_SIGNED_URL_TTL_SECONDS = 3600;

export interface BroadcastTuning {
  messagesPerSecond?: number;
  maxAttempts?: number;
  backoff?: (attempt: number) => number;
  batchSize?: number;
  budgetMs?: number;
}

/**
 * ⚠️ UM DISJUNTOR POR PROCESSO, e ele é o mesmo objeto entre execuções da mesma
 * instância. Criar um novo a cada chamada zeraria o contador de falhas e o
 * disjuntor nunca abriria — que é exatamente o defeito que ele evita.
 */
const breaker = new CircuitBreaker();

interface BroadcastRow {
  id: string;
  source: string;
  body: string;
  media_bucket: string | null;
  media_path: string | null;
  media_filename: string | null;
  image_bucket: string | null;
  image_path: string | null;
}

interface RecipientRow {
  id: string;
  member_id: string | null;
  member_name: string | null;
  member_phone: string;
  attempts: number;
}

export async function drainBroadcastQueue(
  broadcastId: string,
  tuning: BroadcastTuning = {},
): Promise<BroadcastRunOutcome> {
  const correlationId = newCorrelationId();
  const inicio = Date.now();

  const base: BroadcastRunOutcome = {
    broadcastId,
    claimed: 0,
    sent: 0,
    errors: 0,
    remaining: false,
    remainingCount: 0,
    skipped: null,
    correlationId,
  };

  const provider = messagingProvider();
  if (!provider.configured) {
    logBroadcast("error", "broadcast.skipped", {
      broadcastId,
      correlationId,
      provider: provider.name,
      reason: `integração não configurada: falta ${provider.missing.join(", ")}`,
    });
    await finish(broadcastId, "Integração de WhatsApp não configurada.");
    return { ...base, skipped: "not_configured" };
  }

  const admin = createAdminClient();
  const ritmo = throttleDelayMs(tuning.messagesPerSecond ?? DEFAULT_MESSAGES_PER_SECOND);
  const maxTentativas = tuning.maxAttempts ?? MAX_SEND_ATTEMPTS;
  const espera = tuning.backoff ?? backoffDelayMs;
  const tamanhoDoLote = tuning.batchSize ?? BATCH_SIZE;
  const orcamento = tuning.budgetMs ?? RUN_BUDGET_MS;

  const { data: campanha, error: campanhaError } = await admin
    .from("broadcasts")
    .select("id, source, body, media_bucket, media_path, media_filename, image_bucket, image_path")
    .eq("id", broadcastId)
    .maybeSingle<BroadcastRow>();

  if (campanhaError || !campanha) {
    logBroadcast("error", "broadcast.skipped", {
      broadcastId,
      correlationId,
      reason: campanhaError?.message ?? "divulgação não encontrada",
    });
    return { ...base, skipped: "not_found" };
  }

  /*
    ⚠️ OS ANEXOS SÃO ASSINADOS UMA VEZ POR EXECUÇÃO, fora do laço. Assinar por
    destinatário seria uma ida ao Storage por pessoa — mil pessoas, mil
    assinaturas do mesmo arquivo.

    Falha ao assinar NÃO derruba a divulgação: o que não pôde ser assinado fica
    de fora e a mensagem sai assim mesmo. Uma normativa anunciada sem o PDF
    ainda avisa que existe uma normativa nova; uma divulgação que não sai não
    avisa nada.
  */
  const assinar = async (
    bucket: string | null,
    caminho: string | null,
    rotulo: string,
  ): Promise<string | null> => {
    if (!bucket || !caminho) return null;

    const { data: assinada, error: assinaturaError } = await admin.storage
      .from(bucket)
      .createSignedUrl(caminho, MEDIA_SIGNED_URL_TTL_SECONDS);

    if (assinaturaError || !assinada?.signedUrl) {
      logBroadcast("error", "broadcast.started", {
        broadcastId,
        correlationId,
        source: campanha.source,
        outcome: `sem ${rotulo}: a divulgação segue sem ele`,
        reason: assinaturaError?.message ?? "URL assinada vazia",
      });
      return null;
    }

    return assinada.signedUrl;
  };

  const anexoUrl = await assinar(campanha.media_bucket, campanha.media_path, "documento");
  const imagemUrl = await assinar(campanha.image_bucket, campanha.image_path, "imagem");

  // ⚠️ CURA A FILA ANTES DE COMEÇAR. Uma execução anterior pode ter sido morta
  // pela plataforma no meio de um lote, deixando linhas em `sending` — elas não
  // são reivindicáveis e a fila nunca terminaria. Chamar aqui é o que faz
  // "clicar em Continuar" resolver sozinho, sem ninguém descobrir que travou.
  const { data: soltos } = await admin.rpc("release_stale_broadcast_recipients", {
    p_broadcast_id: broadcastId,
  } as never);
  if (typeof soltos === "number" && soltos > 0) {
    logBroadcast("info", "broadcast.started", {
      broadcastId,
      correlationId,
      outcome: `${soltos} presos em sending devolvidos à fila`,
      count: soltos,
    });
  }

  logBroadcast("info", "broadcast.started", {
    broadcastId,
    correlationId,
    source: campanha.source,
    provider: provider.name,
  });

  let enviadas = 0;

  for (;;) {
    if (Date.now() - inicio > orcamento || enviadas >= RUN_MAX_MESSAGES) {
      base.remaining = true;
      logBroadcast("info", "broadcast.interrupted", {
        broadcastId,
        correlationId,
        reason: enviadas >= RUN_MAX_MESSAGES ? "teto de mensagens" : "orçamento de tempo",
        count: enviadas,
      });
      break;
    }

    const { data: lote, error: loteError } = await admin.rpc("claim_broadcast_recipients", {
      p_broadcast_id: broadcastId,
      p_limit: tamanhoDoLote,
    } as never);

    if (loteError) {
      logBroadcast("error", "broadcast.skipped", {
        broadcastId,
        correlationId,
        reason: loteError.message,
      });
      break;
    }

    const destinatarios = (lote ?? []) as RecipientRow[];
    if (destinatarios.length === 0) break;
    base.claimed += destinatarios.length;

    let interrompido = false;

    for (const [indice, destinatario] of destinatarios.entries()) {
      // Fornecedor fora do ar: para a corrida em vez de insistir. O que sobrou
      // do lote fica em `sending` e volta pela cura na próxima execução.
      if (!breaker.allows()) {
        interrompido = true;
        base.remaining = true;
        logBroadcast("error", "send.breaker_open", {
          broadcastId,
          correlationId,
          count: destinatarios.length - indice,
        });
        break;
      }

      const resultado = await sendToRecipient({
        admin,
        provider,
        destinatario,
        mensagem: campanha.body,
        anexoUrl,
        imagemUrl,
        nomeDoArquivo: campanha.media_filename,
        broadcastId,
        correlationId,
        maxTentativas,
        espera,
        ritmo,
      });

      if (resultado === "sent") {
        base.sent += 1;
        enviadas += 1;
        breaker.recordSuccess();
      } else if (resultado === "ineligible") {
        base.errors += 1;
      } else if (resultado === "error") {
        base.errors += 1;
      } else {
        // 'infra': a culpa é do fornecedor, não da pessoa. Só este conta para o
        // disjuntor — um telefone inválido não é sinal de que a Z-API caiu.
        base.errors += 1;
        breaker.recordFailure();
      }

      // O ritmo só entre mensagens que REALMENTE saíram. Esperar depois de um
      // telefone inválido seria queimar orçamento sem ter falado com ninguém.
      if (resultado === "sent" && indice < destinatarios.length - 1) {
        await sleep(ritmo);
      }
    }

    if (interrompido) break;
  }

  const { count } = await admin
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId)
    .in("status", ["pending", "sending"]);

  base.remainingCount = count ?? 0;
  base.remaining = base.remainingCount > 0;

  await finish(broadcastId, null);

  logBroadcast("info", "broadcast.finished", {
    broadcastId,
    correlationId,
    source: campanha.source,
    count: base.sent,
    outcome: base.remaining ? `faltam ${base.remainingCount}` : "fila vazia",
    durationMs: Date.now() - inicio,
  });

  return base;
}

type SendOutcome = "sent" | "error" | "infra" | "ineligible";

async function sendToRecipient({
  admin,
  provider,
  destinatario,
  mensagem,
  anexoUrl,
  imagemUrl,
  nomeDoArquivo,
  broadcastId,
  correlationId,
  maxTentativas,
  espera,
  ritmo,
}: {
  admin: ReturnType<typeof createAdminClient>;
  provider: MessagingProvider;
  destinatario: RecipientRow;
  mensagem: string;
  /** Nulo = sem anexo, ou o anexo não pôde ser assinado. Vai só o texto. */
  anexoUrl: string | null;
  /** A prévia, enviada ANTES e sem legenda. Nulo = módulo sem imagem. */
  imagemUrl: string | null;
  nomeDoArquivo: string | null;
  broadcastId: string;
  correlationId: string;
  maxTentativas: number;
  espera: (attempt: number) => number;
  /** Espera entre mensagens — o ritmo vale por MENSAGEM, não por pessoa. */
  ritmo: number;
}): Promise<SendOutcome> {
  const telefone = toWhatsAppNumber(destinatario.member_phone);

  // ⚠️ TELEFONE INVÁLIDO NÃO É TENTATIVA. Liquidado como erro definitivo, sem
  // chamar o fornecedor: repetir três vezes um número que não existe só gasta
  // orçamento. `landline` entra aqui — fixo não recebe WhatsApp.
  if (!telefone.ok) {
    await admin.rpc("settle_broadcast_recipient", {
      p_recipient_id: destinatario.id,
      p_ok: false,
      p_provider_message_id: null,
      p_error: PHONE_REJECTION_REASONS[telefone.reason],
    } as never);
    logBroadcast("info", "send.ineligible", {
      broadcastId,
      recipientId: destinatario.id,
      correlationId,
      reason: telefone.reason,
      phone: maskPhone(destinatario.member_phone),
    });
    return "ineligible";
  }

  /**
   * ⚠️ A IMAGEM SAI PRIMEIRO, SEM LEGENDA — e o resultado dela NÃO decide o
   * desfecho do destinatário.
   *
   * A ordem é conteúdo: no WhatsApp a imagem chega ABERTA na conversa e é o que
   * faz alguém parar de rolar; o PDF chega fechado, como um cartão de arquivo.
   * Mandando só o PDF, o boletim da semana virava um anexo que ninguém abriu.
   *
   * A legenda fica vazia porque quem carrega a mensagem é o documento — texto
   * nos dois faria a pessoa receber a mesma coisa duas vezes seguidas.
   *
   * E o veredito é do DOCUMENTO, não da imagem: marcar o destinatário como erro
   * porque a prévia não subiu deixaria de fora o boletim inteiro por causa do
   * acessório. Por isso ela tem repetição própria, log próprio, e segue adiante
   * de qualquer jeito.
   *
   * ⚠️ LIMITE CONHECIDO: se o documento falhar e a linha voltar para a fila
   * (pela cura de `sending` ou por um "tentar de novo"), a imagem sai de novo
   * junto. É a mesma troca que a fila inteira já faz — repetir é melhor que
   * sumir —, e a alternativa seria guardar estado por anexo em cada linha.
   */
  if (imagemUrl) {
    for (let tentativa = 1; tentativa <= maxTentativas; tentativa += 1) {
      const resultado = await provider.sendImage({
        to: telefone.e164,
        imageUrl: imagemUrl,
        caption: "",
        correlationId,
      });

      if (resultado.ok) {
        // Sem esta espera, cada destinatário dispara duas mensagens coladas e o
        // ritmo combinado com o fornecedor vira o dobro.
        await sleep(ritmo);
        break;
      }

      const motivo = `${resultado.code}: ${resultado.message}`;

      // Recusa definitiva (formato, tamanho, URL que o fornecedor não baixou)
      // ou fim das tentativas: o documento ainda vai, e é ele que importa.
      if (!resultado.retryable || tentativa === maxTentativas) {
        logBroadcast("error", "send.error", {
          broadcastId,
          recipientId: destinatario.id,
          correlationId,
          outcome: "imagem não saiu; seguindo com o documento",
          reason: motivo,
        });
        break;
      }

      await sleep(espera(tentativa));
    }
  }

  let ultimoErro = "Falha desconhecida ao enviar.";
  let foiInfra = false;

  /**
   * ⚠️ O ANEXO PODE SER ABANDONADO NO MEIO DO CAMINHO, e é a mesma decisão de
   * Eventos com o cartaz. Se o envio do documento falhar de forma DEFINITIVA (a
   * Z-API não conseguiu baixar, o formato não agradou), o laço tenta de novo SEM
   * ele — porque sem isso um problema no PDF faria a pessoa não receber nada
   * sobre uma normativa que existe.
   *
   * Falha TEMPORÁRIA não entra aqui: essa a repetição normal resolve, e
   * desistir do anexo na primeira instabilidade de rede seria trocar o
   * documento por pressa.
   */
  let mandarAnexo = anexoUrl !== null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa += 1) {
    const resultado =
      mandarAnexo && anexoUrl
        ? await provider.sendDocument({
            to: telefone.e164,
            documentUrl: anexoUrl,
            // Sem nome guardado, um padrão legível — melhor que o que o
            // fornecedor inventaria sozinho.
            fileName: nomeDoArquivo ?? "apcs.pdf",
            caption: mensagem,
            correlationId,
          })
        : await provider.send({
            to: telefone.e164,
            body: mensagem,
            correlationId,
          });

    if (resultado.ok) {
      await admin.rpc("settle_broadcast_recipient", {
        p_recipient_id: destinatario.id,
        p_ok: true,
        p_provider_message_id: resultado.providerMessageId,
        p_error: null,
      } as never);
      logBroadcast("info", "send.ok", {
        broadcastId,
        recipientId: destinatario.id,
        correlationId,
        providerMessageId: resultado.providerMessageId,
        attempt: tentativa,
        phone: maskPhone(destinatario.member_phone),
      });
      return "sent";
    }

    ultimoErro = `${resultado.code}: ${resultado.message}`;
    foiInfra = resultado.retryable;

    // O anexo falhou de vez: repete SEM ele, e esta tentativa não conta como
    // gasta — o telefone continua bom, só o arquivo é que não foi.
    if (!resultado.retryable && mandarAnexo) {
      mandarAnexo = false;
      logBroadcast("error", "send.error", {
        broadcastId,
        recipientId: destinatario.id,
        correlationId,
        outcome: "anexo recusado; repetindo só com o texto",
        reason: ultimoErro,
      });
      tentativa -= 1;
      continue;
    }

    // Erro definitivo (número recusado, credencial errada): insistir não
    // conserta. Sai do laço na primeira.
    if (!resultado.retryable) break;

    if (tentativa < maxTentativas) await sleep(espera(tentativa));
  }

  await admin.rpc("settle_broadcast_recipient", {
    p_recipient_id: destinatario.id,
    p_ok: false,
    p_provider_message_id: null,
    p_error: ultimoErro,
  } as never);

  logBroadcast("error", "send.error", {
    broadcastId,
    recipientId: destinatario.id,
    correlationId,
    reason: ultimoErro,
    phone: maskPhone(destinatario.member_phone),
  });

  return foiInfra ? "infra" : "error";
}

/**
 * Encerra a corrida.
 *
 * ⚠️ QUEM DECIDE SE ACABOU É O BANCO, não este arquivo. `finish_broadcast`
 * conta a fila e só marca `done` se não sobrou ninguém — um status calculado
 * aqui, a partir de contadores em memória, erraria em toda execução
 * interrompida, e a tela diria "concluída" para uma divulgação que metade da
 * base não recebeu.
 */
async function finish(broadcastId: string, lastError: string | null): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("finish_broadcast", {
    p_broadcast_id: broadcastId,
    p_last_error: lastError,
  } as never);
  if (error) {
    logBroadcast("error", "broadcast.finished", {
      broadcastId,
      outcome: "não foi possível encerrar a corrida",
      reason: error.message,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
