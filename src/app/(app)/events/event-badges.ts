import type { BadgeProps } from "@/components/ui/badge";
import type { EventEffectiveStatus } from "@/modules/event/event.types";

/**
 * Selo de status do evento.
 *
 * As variantes são as que já existem no design system, e a escolha segue o
 * SIGNIFICADO delas, não a cor: `attention` é o único que usa a cor da marca e
 * quer dizer "está valendo agora"; `done` quer dizer "encerrado, sem
 * pendência", que é exatamente um evento que já aconteceu; `default` fica com a
 * inativação manual, que é uma decisão e não um encerramento natural.
 *
 * Nenhuma cor nova foi criada para este módulo.
 */
export const STATUS_BADGE_VARIANT: Record<EventEffectiveStatus, BadgeProps["variant"]> = {
  active: "attention",
  inactive: "default",
  expired: "done",
};
