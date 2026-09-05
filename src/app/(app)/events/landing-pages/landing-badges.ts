import type { BadgeProps } from "@/components/ui/badge";
import type { LandingPageStatus } from "@/modules/event/event.landing.types";

/**
 * Selo de situação da Landing Page.
 *
 * As variantes são as que já existem no design system, e a escolha segue o
 * SIGNIFICADO delas, não a cor — a mesma regra de `STATUS_BADGE_VARIANT` em
 * Eventos:
 *
 *   `attention`  usa a cor da marca e quer dizer "está valendo agora"
 *   `done`       encerrado, sem pendência
 *   `default`    neutro: nem no ar, nem encerrado
 *
 * O rascunho fica em `default` e não em `attention` de propósito: uma página
 * que ninguém publicou ainda não pede ação de ninguém — ela está em construção.
 *
 * Nenhuma cor nova foi criada para este módulo.
 */
export const LANDING_STATUS_BADGE_VARIANT: Record<LandingPageStatus, BadgeProps["variant"]> = {
  draft: "default",
  published: "attention",
  closed: "done",
  inactive: "default",
};
