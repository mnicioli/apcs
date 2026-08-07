import type { BadgeProps } from "@/components/ui/badge";
import type { AttendanceReason, AttendanceSituation } from "@/modules/attendance/attendance.types";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/**
 * De motivo/situação para a cor do selo.
 *
 * Mora numa tela, e não no módulo, de propósito: qual estado merece destaque é
 * decisão de APRESENTAÇÃO. O domínio diz que a conversa está sem lead gravado;
 * dizer que isso é vermelho é escolha desta interface.
 */
export function reasonBadgeVariant(reason: AttendanceReason): BadgeVariant {
  // Só `lead_failed` é alarme: o contato não existe em nenhum outro lugar do
  // sistema. Os outros são trabalho normal da fila — pintar todos de vermelho
  // faria nenhum se destacar.
  return reason === "lead_failed" ? "alert" : "attention";
}

export function situationBadgeVariant(situation: AttendanceSituation): BadgeVariant {
  switch (situation) {
    case "queued":
      return "attention";
    case "assigned":
      return "default";
    case "resolved":
    case "no_action":
      return "done";
  }
}
