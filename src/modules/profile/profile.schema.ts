import { z } from "zod";

/**
 * Schema de validação do formulário de perfil. Fonte única da verdade para
 * validar tanto no client (React Hook Form) quanto no server (Server Action).
 */
export const profileFormSchema = z.object({
  fullName: z.string().trim().min(2, "Informe seu nome completo.").max(120, "Nome muito longo."),
});

export type ProfileFormData = z.infer<typeof profileFormSchema>;
