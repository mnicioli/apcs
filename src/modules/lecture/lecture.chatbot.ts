import { LECTURE_STATUS_HINTS, LECTURE_STATUS_LABELS } from "./lecture.labels";
import type { Lecture, LectureStatus } from "./lecture.types";

/**
 * O CONTRATO DO CHATBOT — o recorte de campos que pode sair para fora da APCS.
 *
 * ⚠️ A lista é fechada, e o que está FORA importa mais que o que está dentro:
 * não vai nome de funcionário (responsável, palestrante, quem cadastrou), não
 * vai prioridade, não vai motivo de rejeição, não vai observação interna. Quem
 * consulta o próprio protocolo é uma pessoa de fora; tudo que a APCS anota
 * sobre o pedido é conversa interna.
 *
 * O motivo da rejeição fica de fora até que exista uma decisão de negócio sobre
 * o que comunicar — inventar "seu pedido foi rejeitado porque X" a partir de uma
 * anotação interna é o tipo de vazamento que só se descobre depois de acontecer.
 * Ver docs/PALESTRAS.md.
 */
export interface ChatbotLecture {
  protocol: string;
  status: LectureStatus;
  /** O rótulo PT-BR, já pronto — o bot não deve traduzir enum. */
  statusLabel: string;
  /** Uma frase sobre o que aquela situação significa. */
  statusHint: string;
  theme: string;
  city: string;
  eventDate: string;
  startTime: string | null;
  requestedAt: string;
}

export function toChatbotLecture(lecture: Lecture): ChatbotLecture {
  return {
    protocol: lecture.protocol,
    status: lecture.status,
    statusLabel: LECTURE_STATUS_LABELS[lecture.status],
    statusHint: LECTURE_STATUS_HINTS[lecture.status],
    theme: lecture.theme,
    city: lecture.city,
    eventDate: lecture.eventDate,
    startTime: lecture.startTime,
    requestedAt: lecture.requestedAt,
  };
}

/**
 * O resultado de uma consulta por protocolo (§60).
 *
 * ⚠️ Os dois "nãos" — não existe, e existe mas não é seu — colapsam em
 * `not-found`. Distinguir os dois confirmaria a existência de um protocolo a
 * quem não deveria saber dele, e é assim que uma varredura de SOL-000001 a
 * SOL-000999 vira um mapa de quem pediu palestra para a APCS.
 */
export type ChatbotLectureResult =
  | { status: "found"; lecture: ChatbotLecture }
  | { status: "not-found" };

/**
 * O resultado de uma solicitação (§58, §59).
 *
 * `failed` não carrega detalhe nenhum de propósito: o que o bot diz nesse caso
 * é um texto fixo do catálogo, e a causa real fica no log do servidor.
 */
export type ChatbotLectureRequestResult =
  | { status: "created"; protocol: string; lectureStatus: LectureStatus }
  | { status: "invalid"; issues: string[] }
  | { status: "failed" };
