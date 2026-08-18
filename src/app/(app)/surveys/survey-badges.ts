import type { BadgeProps } from "@/components/ui/badge";
import type {
  SurveyRecipientStatus,
  SurveyStage,
  SurveyStatus,
} from "@/modules/survey/survey.types";

/**
 * Os selos de Enquetes.
 *
 * ⚠️ NENHUMA COR NOVA. O design system tem quatro variantes, com significados
 * declarados em `ui/badge.tsx`:
 *
 *   default    estado normal, sem urgência
 *   attention  pede ação de alguém — o único que usa a cor da marca
 *   done       encerrado, resolvido, sem pendência
 *   alert      algo saiu errado e precisa de olho humano
 *
 * ⚠️ E a cor é SEMPRE o sinal secundário (§3, §61): o texto do selo diz qual é a
 * situação, sozinho. Quem não distingue as cores lê "Ativa" e "Encerrada" do
 * mesmo jeito.
 */
export const STATUS_BADGE_VARIANT: Record<SurveyStatus, BadgeProps["variant"]> = {
  // Em construção — nada acontecendo, ninguém esperando.
  draft: "default",
  // Pronta e esperando a hora. Também sem pendência humana.
  scheduled: "default",
  // O que está VALENDO. Mesmo tratamento que a Bolsa dá à publicação vigente e
  // Palestras à palestra confirmada.
  active: "attention",
  // Os dois encerramentos. Cancelada NÃO é `alert`: cancelar uma enquete é uma
  // decisão tomada, não um erro a investigar.
  closed: "done",
  cancelled: "done",
};

/**
 * O selo da ETAPA derivada — e é aqui que `alert` finalmente cabe.
 *
 * "Prazo encerrado" quer dizer: a enquete está marcada como ativa, a data de
 * encerramento já passou, e o banco já recusa resposta. É exatamente "precisa de
 * olho humano" — alguém precisa encerrar para o registro parar de mentir.
 */
export const STAGE_BADGE_VARIANT: Record<SurveyStage, BadgeProps["variant"]> = {
  draft: "default",
  scheduled: "default",
  open: "attention",
  expired: "alert",
  closed: "done",
  cancelled: "done",
};

/**
 * O estado de cada pessoa no disparo (§39).
 *
 * O que se procura varrendo essa lista com o olho são as FALHAS — daí `alert` só
 * no erro. `responded` ganha `attention` porque é a conversão: é o que a
 * campanha queria.
 */
export const RECIPIENT_BADGE_VARIANT: Record<SurveyRecipientStatus, BadgeProps["variant"]> = {
  pending: "default",
  sending: "default",
  sent: "default",
  delivered: "default",
  read: "default",
  responded: "attention",
  error: "alert",
};
