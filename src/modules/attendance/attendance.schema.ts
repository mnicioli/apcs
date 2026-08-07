import { z } from "zod";

/**
 * Contratos de entrada da Central de Atendimento. O mesmo schema roda no
 * cliente (React Hook Form) e dentro da action — defesa em profundidade.
 */

/**
 * As quatro transições possíveis do atendimento humano.
 *
 * São COMANDOS, não um estado a escolher: quem decide `resolved_at`/`assigned_to`
 * é o servidor. Um formulário que mandasse as datas prontas deixaria o cliente
 * escrever "concluído ontem".
 */
export const ATTENDANCE_COMMANDS = ["assign", "release", "resolve", "reopen"] as const;
export type AttendanceCommand = (typeof ATTENDANCE_COMMANDS)[number];

export const attendanceCommandSchema = z.object({
  command: z.enum(ATTENDANCE_COMMANDS),
});

export type AttendanceCommandInput = z.infer<typeof attendanceCommandSchema>;

/** Anotação interna do time. O limite bate com o CHECK da tabela. */
export const attendanceNotesFormSchema = z.object({
  internalNotes: z.string().trim().max(2000, "Anotação muito longa.").optional(),
});

export type AttendanceNotesFormData = z.infer<typeof attendanceNotesFormSchema>;
