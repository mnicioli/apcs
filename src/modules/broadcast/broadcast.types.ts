import type { Database } from "@/types/database";

/**
 * DIVULGAÇÃO — o envio de WhatsApp saído de Normativas, Comunicação, Bolsa e
 * Palestras.
 *
 * ⚠️ EVENTOS E ENQUETES NÃO PASSAM POR AQUI. Os dois têm fila própria, escrita
 * antes desta e em produção. Trazer os dois para cá seria reescrever o que
 * funciona; a decisão está no cabeçalho de 20260901000100_broadcasts.sql.
 */

export type BroadcastSource = Database["public"]["Enums"]["broadcast_source"];
export type BroadcastStatus = Database["public"]["Enums"]["broadcast_status"];

/**
 * O QUE VAI SER DIVULGADO, já normalizado.
 *
 * ⚠️ ESTE TIPO É MONTADO NO SERVIDOR, LENDO O BANCO — nunca vem do formulário.
 * A tela manda só "qual módulo, qual id, quais públicos"; o texto é composto a
 * partir do registro de verdade. Aceitar o corpo da mensagem do cliente
 * transformaria a tela num disparador de texto livre para toda a base, assinado
 * pela APCS.
 */
export type BroadcastSubject =
  | {
      source: "normative" | "communication";
      title: string;
      /** Data de vigência da versão publicada. */
      effectiveDate: string;
    }
  | {
      source: "market_bulletin";
      title: string;
      /** Data de referência do boletim. */
      effectiveDate: string;
      versionName: string;
    }
  | {
      source: "lecture";
      title: string;
      eventDate: string;
      startTime: string | null;
      endTime: string | null;
      city: string;
      location: string | null;
    };

/** O arquivo que vai anexado, quando há. */
export interface BroadcastMedia {
  bucket: string;
  path: string;
  mime: string;
  filename: string;
}

/** Uma divulgação, como as telas a leem. */
export interface Broadcast {
  id: string;
  source: BroadcastSource;
  sourceId: string;
  title: string;
  body: string;
  status: BroadcastStatus;
  hasMedia: boolean;
  totalRecipients: number;
  totalSent: number;
  totalErrors: number;
  totalBlocked: number;
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  createdByName: string | null;
  /** Nomes dos públicos-alvo escolhidos, para a tela dizer "para quem". */
  segmentNames: string[];
}

/**
 * Quantas pessoas um conjunto de públicos alcança AGORA.
 *
 * ⚠️ `blocked` APARECE SEPARADO, e não somado nem escondido. "312 pessoas, 18
 * bloqueadas" diz duas coisas verdadeiras; "330 pessoas" mentiria, e "312
 * pessoas" sozinho esconderia que dezoito associados pediram para não receber —
 * que é informação de gestão, não detalhe técnico.
 */
export interface BroadcastAudience {
  reachable: number;
  blocked: number;
}

/** O que a corrida do worker devolve. */
export interface BroadcastRunOutcome {
  broadcastId: string;
  claimed: number;
  sent: number;
  errors: number;
  /** Ainda há gente na fila: a tela oferece "continuar". */
  remaining: boolean;
  remainingCount: number;
  /** Preenchido quando a corrida nem começou (integração desligada, p.ex.). */
  skipped: string | null;
  correlationId: string;
}
