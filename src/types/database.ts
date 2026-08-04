/**
 * Tipos do banco — REFERÊNCIA / PLACEHOLDER.
 *
 * Este arquivo é GERADO automaticamente a partir do schema do Supabase.
 * Sempre que você alterar o schema (criar/alterar tabela numa migration),
 * regenere com:
 *
 *   pnpm db:types
 *
 * NÃO edite este arquivo à mão — suas mudanças serão sobrescritas. Esta
 * versão inicial cobre apenas `profiles` para o projeto compilar antes do
 * primeiro `pnpm db:types`.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          role: Database["public"]["Enums"]["app_role"];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      current_app_role: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["app_role"];
      };
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
    };
    Enums: {
      app_role: "admin" | "ceo" | "pm" | "tech_lead" | "comercial" | "financeiro" | "viewer";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// Atalhos convenientes.
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
