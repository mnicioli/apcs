import type { BadgeProps } from "@/components/ui/badge";
import type { MarketVersionSituation } from "@/modules/market/market.types";

/**
 * Selo da situação de uma publicação.
 *
 * As variantes são as que já existem no design system, e a escolha segue o
 * SIGNIFICADO delas, não a cor: `attention` é o único que usa a cor da marca e
 * quer dizer "está valendo agora"; `default` fica com a publicação programada,
 * que é uma decisão tomada mas ainda sem efeito; `done` quer dizer "encerrado,
 * sem pendência", que é exatamente uma publicação substituída.
 *
 * Nenhuma cor nova foi criada para este módulo.
 */
export const SITUATION_BADGE_VARIANT: Record<MarketVersionSituation, BadgeProps["variant"]> = {
  current: "attention",
  scheduled: "default",
  historical: "done",
};
