import type { BadgeProps } from "@/components/ui/badge";
import type {
  MemberStatus,
  MembershipApplicationStatus,
} from "@/modules/membership/membership.types";

/**
 * Os selos de Associados.
 *
 * ⚠️ NENHUMA COR NOVA. O design system tem quatro variantes, com significados
 * declarados em `ui/badge.tsx`:
 *
 *   default    estado normal, sem urgência
 *   attention  pede ação de alguém — o único que usa a cor da marca
 *   done       encerrado, resolvido, sem pendência
 *   alert      algo saiu errado e precisa de olho humano
 *
 * E a cor é SEMPRE o sinal secundário: o texto do selo diz qual é a situação,
 * sozinho. Quem não distingue as cores lê "Aguardando" e "Aprovada" do mesmo
 * jeito.
 */
export const APPLICATION_BADGE_VARIANT: Record<MembershipApplicationStatus, BadgeProps["variant"]> =
  {
    // Chegou e ninguém pegou: é a única que pede ação de alguém.
    pending: "attention",
    // Alguém já assumiu — a pendência tem dono, e dono não é alarme.
    in_review: "default",
    // Virou associado.
    approved: "done",
    // ⚠️ `done`, e NÃO `alert`. Recusar uma solicitação é uma decisão tomada,
    // não um erro a investigar — o mesmo raciocínio que faz "Cancelada" ser
    // `done` em Enquetes.
    rejected: "done",
  };

export const MEMBER_BADGE_VARIANT: Record<MemberStatus, BadgeProps["variant"]> = {
  active: "attention",
  inactive: "done",
  // Suspenso é temporário e alguém precisa resolver: é o único do módulo em que
  // `alert` cabe.
  suspended: "alert",
};
