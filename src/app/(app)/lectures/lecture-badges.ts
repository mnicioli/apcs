import type { BadgeProps } from "@/components/ui/badge";
import type {
  LectureOrigin,
  LecturePriority,
  LectureStage,
  LectureStatus,
} from "@/modules/lecture/lecture.types";

/**
 * Os selos de Palestras.
 *
 * ⚠️ NENHUMA COR NOVA. O design system tem quatro variantes, com significados
 * declarados em `ui/badge.tsx`:
 *
 *   default    estado normal, sem urgência
 *   attention  pede ação de alguém — o único que usa a cor da marca
 *   done       encerrado, resolvido, sem pendência
 *   alert      algo saiu errado e precisa de olho humano
 *
 * São oito situações para quatro variantes, então algumas COMPARTILHAM a cor — e
 * isso é a decisão, não uma limitação sofrida. A cor é o sinal secundário: ela
 * separa "pede ação" de "em curso" de "encerrado", que é o que se lê varrendo a
 * grid com o olho. Quem é qual, exatamente, está escrito dentro do próprio selo.
 * Inventar quatro cores novas para diferenciar `approved` de `planned` daria
 * oito tons que ninguém memoriza e um design system que não é mais um.
 */
export const STATUS_BADGE_VARIANT: Record<LectureStatus, BadgeProps["variant"]> = {
  // Chegou e ninguém olhou: é literalmente "pede ação de alguém".
  requested: "attention",
  // Já está com uma pessoa — em curso, sem pendência para o time.
  under_review: "default",
  approved: "default",
  planned: "default",
  // Firme na agenda. Mesmo tratamento que a Bolsa dá à publicação vigente e
  // Eventos ao evento ativo: é o estado que "está valendo".
  confirmed: "attention",
  // Os três encerramentos. Rejeitada e cancelada NÃO são `alert`: recusar uma
  // palestra é uma decisão tomada, não um erro a investigar.
  held: "done",
  rejected: "done",
  cancelled: "done",
};

/**
 * O selo da ETAPA derivada — e é aqui que `alert` finalmente cabe.
 *
 * "Aguardando registro" quer dizer: a data passou, a palestra estava marcada, e
 * ninguém disse se aconteceu. É exatamente "precisa de olho humano", e é a única
 * coisa neste módulo que o merece.
 */
export const STAGE_BADGE_VARIANT: Record<LectureStage, BadgeProps["variant"]> = {
  pending: "attention",
  scheduled: "default",
  awaiting_outcome: "alert",
  closed: "done",
};

export const PRIORITY_BADGE_VARIANT: Record<LecturePriority, BadgeProps["variant"]> = {
  low: "done",
  normal: "default",
  high: "attention",
  urgent: "alert",
};

/**
 * A origem (§39, §45).
 *
 * `attention` no chatbot não é enfeite: uma solicitação que veio de fora tem
 * alguém do outro lado esperando resposta, e é isso que a distingue de uma
 * palestra que o próprio time marcou.
 */
export const ORIGIN_BADGE_VARIANT: Record<LectureOrigin, BadgeProps["variant"]> = {
  chatbot: "attention",
  internal: "default",
};
