import type { Role } from "@/lib/rbac/rbac.types";

/**
 * Tipo de domínio do perfil (camelCase), desacoplado da linha crua do banco.
 * Services mapeiam a Row do Supabase (snake_case) para este formato.
 */
export interface Profile {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: Role;
}
