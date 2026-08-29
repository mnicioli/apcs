import { eventTimeRangeBr, formatEventDateBr } from "@/modules/event/event.labels";
import type { BroadcastSource, BroadcastStatus, BroadcastSubject } from "./broadcast.types";

/**
 * O QUE CHEGA NO CELULAR DO ASSOCIADO.
 *
 * ⚠️ O FORMATO É O MESMO DE EVENTOS, e reusa as funções de lá em vez de
 * reescrevê-las. Quem recebe da APCS não distingue "módulo de eventos" de
 * "módulo de documentos" — recebe mensagens da APCS. Duas formatações
 * diferentes de data na mesma conversa parecem dois remetentes.
 *
 * ⚠️ A LINHA DO "SAIR" É OBRIGATÓRIA EM TODAS AS MENSAGENS, e não é cortesia:
 * é ela que ensina a palavra que o webhook reconhece para registrar o opt-out.
 * Uma divulgação sem ela é uma mensagem da qual não há como escapar — e o teste
 * abaixo é o que impede alguém de retirá-la "para encurtar".
 */

const CABECALHO = "*APCS — Associação Paulista de Criadores de Suínos*";
export const BROADCAST_OPT_OUT_LINE = "Para não receber mais avisos da APCS, responda SAIR.";

export const BROADCAST_SOURCE_LABELS: Record<BroadcastSource, string> = {
  normative: "Normativa",
  communication: "Comunicação",
  market_bulletin: "Boletim da Bolsa",
  lecture: "Palestra",
};

/** A chamada de cada tipo, na segunda linha da mensagem. */
const CHAMADA: Record<BroadcastSource, string> = {
  normative: "Nova normativa publicada",
  communication: "Novo comunicado",
  market_bulletin: "Novo boletim de preços",
  lecture: "Palestra confirmada",
};

export const BROADCAST_STATUS_LABELS: Record<BroadcastStatus, string> = {
  running: "Em andamento",
  done: "Concluída",
  failed: "Com falha",
};

/**
 * Monta a mensagem a partir do registro de verdade.
 *
 * ⚠️ A FUNÇÃO É PURA E EXAUSTIVA no `switch`. Uma origem nova no enum quebra o
 * type-check aqui, em vez de cair num `default` que manda uma mensagem genérica
 * para a base inteira.
 */
export function broadcastWhatsAppMessage(subject: BroadcastSubject): string {
  const linhas: string[] = [
    CABECALHO,
    "",
    `*${CHAMADA[subject.source]}*`,
    "",
    `*${subject.title}*`,
  ];

  switch (subject.source) {
    case "normative":
    case "communication":
      linhas.push(`📅 *Vigente desde:* ${formatEventDateBr(subject.effectiveDate)}`);
      // ⚠️ ANUNCIA O ANEXO. O PDF chega como um cartão separado na conversa, e
      // sem esta linha a mensagem parece incompleta — a pessoa lê o texto,
      // procura o documento e conclui que faltou.
      linhas.push("", "O documento está em anexo.");
      break;

    case "market_bulletin":
      linhas.push(`📅 *Referência:* ${formatEventDateBr(subject.effectiveDate)}`);
      linhas.push("", "O boletim está em anexo.");
      break;

    case "lecture": {
      linhas.push(`📅 *Data:* ${formatEventDateBr(subject.eventDate)}`);
      if (subject.startTime) {
        linhas.push(`🕒 *Horário:* ${eventTimeRangeBr(subject.startTime, subject.endTime)}`);
      }
      // A palestra guarda cidade sempre e local às vezes: "Piracicaba" sozinho
      // é menos útil que "Cooperativa X, Piracicaba", mas é melhor que nada.
      const onde = subject.location ? `${subject.location}, ${subject.city}` : subject.city;
      linhas.push(`📍 *Local:* ${onde}`);
      break;
    }
  }

  linhas.push("", BROADCAST_OPT_OUT_LINE);

  return linhas.join("\n");
}

/** O título curto que fica guardado na campanha e aparece no histórico. */
export function broadcastTitle(subject: BroadcastSubject): string {
  return subject.title;
}
