export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      chat_contacts: {
        Row: {
          city: string | null;
          contact_profile: Database["public"]["Enums"]["chat_contact_profile"] | null;
          created_at: string;
          email: string | null;
          full_name: string | null;
          id: string;
          phone: string | null;
          preferred_channel: Database["public"]["Enums"]["chat_contact_channel"] | null;
          preferred_time: Database["public"]["Enums"]["chat_contact_time"] | null;
          state: string | null;
          updated_at: string;
        };
        Insert: {
          city?: string | null;
          contact_profile?: Database["public"]["Enums"]["chat_contact_profile"] | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          phone?: string | null;
          preferred_channel?: Database["public"]["Enums"]["chat_contact_channel"] | null;
          preferred_time?: Database["public"]["Enums"]["chat_contact_time"] | null;
          state?: string | null;
          updated_at?: string;
        };
        Update: {
          city?: string | null;
          contact_profile?: Database["public"]["Enums"]["chat_contact_profile"] | null;
          created_at?: string;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          phone?: string | null;
          preferred_channel?: Database["public"]["Enums"]["chat_contact_channel"] | null;
          preferred_time?: Database["public"]["Enums"]["chat_contact_time"] | null;
          state?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      chat_conversations: {
        Row: {
          assigned_at: string | null;
          assigned_to: string | null;
          collected: Json;
          consent_given_at: string | null;
          consent_policy_version: string | null;
          contact_id: string | null;
          created_at: string;
          flow_key: Database["public"]["Enums"]["chat_flow_key"];
          id: string;
          internal_notes: string | null;
          ip_hash: string | null;
          last_message_at: string;
          resolved_at: string | null;
          session_token_hash: string;
          status: Database["public"]["Enums"]["chat_conversation_status"];
          updated_at: string;
          user_agent: string | null;
        };
        Insert: {
          assigned_at?: string | null;
          assigned_to?: string | null;
          collected?: Json;
          consent_given_at?: string | null;
          consent_policy_version?: string | null;
          contact_id?: string | null;
          created_at?: string;
          flow_key?: Database["public"]["Enums"]["chat_flow_key"];
          id?: string;
          internal_notes?: string | null;
          ip_hash?: string | null;
          last_message_at?: string;
          resolved_at?: string | null;
          session_token_hash: string;
          status?: Database["public"]["Enums"]["chat_conversation_status"];
          updated_at?: string;
          user_agent?: string | null;
        };
        Update: {
          assigned_at?: string | null;
          assigned_to?: string | null;
          collected?: Json;
          consent_given_at?: string | null;
          consent_policy_version?: string | null;
          contact_id?: string | null;
          created_at?: string;
          flow_key?: Database["public"]["Enums"]["chat_flow_key"];
          id?: string;
          internal_notes?: string | null;
          ip_hash?: string | null;
          last_message_at?: string;
          resolved_at?: string | null;
          session_token_hash?: string;
          status?: Database["public"]["Enums"]["chat_conversation_status"];
          updated_at?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "chat_conversations_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chat_conversations_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "chat_contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_messages: {
        Row: {
          content: string;
          content_key: string | null;
          conversation_id: string;
          created_at: string;
          id: string;
          llm_meta: Json | null;
          role: Database["public"]["Enums"]["chat_message_role"];
          seq: number;
        };
        Insert: {
          content: string;
          content_key?: string | null;
          conversation_id: string;
          created_at?: string;
          id?: string;
          llm_meta?: Json | null;
          role: Database["public"]["Enums"]["chat_message_role"];
          seq?: never;
        };
        Update: {
          content?: string;
          content_key?: string | null;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          llm_meta?: Json | null;
          role?: Database["public"]["Enums"]["chat_message_role"];
          seq?: never;
        };
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "chat_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      csp_leads: {
        Row: {
          city: string;
          contact_id: string | null;
          contact_profile: Database["public"]["Enums"]["chat_contact_profile"];
          conversation_id: string;
          created_at: string;
          email: string | null;
          full_name: string;
          id: string;
          interest: Database["public"]["Enums"]["csp_interest"];
          notes: string | null;
          phone: string | null;
          preferred_channel: Database["public"]["Enums"]["chat_contact_channel"];
          preferred_time: Database["public"]["Enums"]["chat_contact_time"] | null;
          state: string;
          status: Database["public"]["Enums"]["lead_status"];
          updated_at: string;
          volume_range: Database["public"]["Enums"]["csp_volume_range"] | null;
        };
        Insert: {
          city: string;
          contact_id?: string | null;
          contact_profile: Database["public"]["Enums"]["chat_contact_profile"];
          conversation_id: string;
          created_at?: string;
          email?: string | null;
          full_name: string;
          id?: string;
          interest: Database["public"]["Enums"]["csp_interest"];
          notes?: string | null;
          phone?: string | null;
          preferred_channel: Database["public"]["Enums"]["chat_contact_channel"];
          preferred_time?: Database["public"]["Enums"]["chat_contact_time"] | null;
          state: string;
          status?: Database["public"]["Enums"]["lead_status"];
          updated_at?: string;
          volume_range?: Database["public"]["Enums"]["csp_volume_range"] | null;
        };
        Update: {
          city?: string;
          contact_id?: string | null;
          contact_profile?: Database["public"]["Enums"]["chat_contact_profile"];
          conversation_id?: string;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id?: string;
          interest?: Database["public"]["Enums"]["csp_interest"];
          notes?: string | null;
          phone?: string | null;
          preferred_channel?: Database["public"]["Enums"]["chat_contact_channel"];
          preferred_time?: Database["public"]["Enums"]["chat_contact_time"] | null;
          state?: string;
          status?: Database["public"]["Enums"]["lead_status"];
          updated_at?: string;
          volume_range?: Database["public"]["Enums"]["csp_volume_range"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "csp_leads_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "chat_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "csp_leads_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: true;
            referencedRelation: "chat_conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      document_audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["document_audit_action"];
          actor_id: string | null;
          created_at: string;
          document_id: string | null;
          id: number;
          metadata: Json;
          version_id: string | null;
        };
        Insert: {
          action: Database["public"]["Enums"]["document_audit_action"];
          actor_id?: string | null;
          created_at?: string;
          document_id?: string | null;
          id?: never;
          metadata?: Json;
          version_id?: string | null;
        };
        Update: {
          action?: Database["public"]["Enums"]["document_audit_action"];
          actor_id?: string | null;
          created_at?: string;
          document_id?: string | null;
          id?: never;
          metadata?: Json;
          version_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "document_audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_audit_logs_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_audit_logs_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "document_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      document_versions: {
        Row: {
          activated_at: string | null;
          activated_by: string | null;
          available_for_chatbot: boolean;
          deactivated_at: string | null;
          deactivated_by: string | null;
          document_id: string;
          effective_date: string;
          file_size_bytes: number;
          id: string;
          mime_type: string;
          original_filename: string;
          status: Database["public"]["Enums"]["document_version_status"];
          storage_path: string;
          uploaded_at: string;
          uploaded_by: string | null;
          version: number;
        };
        Insert: {
          activated_at?: string | null;
          activated_by?: string | null;
          available_for_chatbot?: boolean;
          deactivated_at?: string | null;
          deactivated_by?: string | null;
          document_id: string;
          effective_date: string;
          file_size_bytes: number;
          id?: string;
          mime_type?: string;
          original_filename: string;
          status?: Database["public"]["Enums"]["document_version_status"];
          storage_path: string;
          uploaded_at?: string;
          uploaded_by?: string | null;
          version: number;
        };
        Update: {
          activated_at?: string | null;
          activated_by?: string | null;
          available_for_chatbot?: boolean;
          deactivated_at?: string | null;
          deactivated_by?: string | null;
          document_id?: string;
          effective_date?: string;
          file_size_bytes?: number;
          id?: string;
          mime_type?: string;
          original_filename?: string;
          status?: Database["public"]["Enums"]["document_version_status"];
          storage_path?: string;
          uploaded_at?: string;
          uploaded_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "document_versions_activated_by_fkey";
            columns: ["activated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_versions_deactivated_by_fkey";
            columns: ["deactivated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_versions_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_versions_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      documents: {
        Row: {
          category: Database["public"]["Enums"]["document_category"];
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          category?: Database["public"]["Enums"]["document_category"];
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          category?: Database["public"]["Enums"]["document_category"];
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "documents_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      activate_document_version: {
        Args: { p_version_id: string };
        Returns: {
          activated_at: string | null;
          activated_by: string | null;
          available_for_chatbot: boolean;
          deactivated_at: string | null;
          deactivated_by: string | null;
          document_id: string;
          effective_date: string;
          file_size_bytes: number;
          id: string;
          mime_type: string;
          original_filename: string;
          status: Database["public"]["Enums"]["document_version_status"];
          storage_path: string;
          uploaded_at: string;
          uploaded_by: string | null;
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "document_versions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_document_version: {
        Args: {
          p_document_id: string;
          p_effective_date: string;
          p_file_size_bytes: number;
          p_original_filename: string;
          p_storage_path: string;
        };
        Returns: {
          activated_at: string | null;
          activated_by: string | null;
          available_for_chatbot: boolean;
          deactivated_at: string | null;
          deactivated_by: string | null;
          document_id: string;
          effective_date: string;
          file_size_bytes: number;
          id: string;
          mime_type: string;
          original_filename: string;
          status: Database["public"]["Enums"]["document_version_status"];
          storage_path: string;
          uploaded_at: string;
          uploaded_by: string | null;
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "document_versions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      current_app_role: {
        Args: never;
        Returns: Database["public"]["Enums"]["app_role"];
      };
      deactivate_document_version: {
        Args: { p_version_id: string };
        Returns: {
          activated_at: string | null;
          activated_by: string | null;
          available_for_chatbot: boolean;
          deactivated_at: string | null;
          deactivated_by: string | null;
          document_id: string;
          effective_date: string;
          file_size_bytes: number;
          id: string;
          mime_type: string;
          original_filename: string;
          status: Database["public"]["Enums"]["document_version_status"];
          storage_path: string;
          uploaded_at: string;
          uploaded_by: string | null;
          version: number;
        };
        SetofOptions: {
          from: "*";
          to: "document_versions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      is_admin: { Args: never; Returns: boolean };
      lock_document: { Args: { p_document_id: string }; Returns: undefined };
    };
    Enums: {
      app_role: "admin" | "ceo" | "pm" | "tech_lead" | "comercial" | "financeiro" | "viewer";
      chat_contact_channel: "whatsapp" | "phone" | "email";
      chat_contact_profile: "producer" | "member" | "supplier";
      chat_contact_time: "morning" | "afternoon" | "evening" | "any";
      chat_conversation_status: "active" | "completed" | "handoff" | "declined" | "abandoned";
      chat_flow_key: "csp";
      chat_message_role: "user" | "bot";
      csp_interest: "input" | "feed" | "logistics" | "information";
      csp_volume_range:
        | "up_to_50"
        | "from_50_to_200"
        | "from_200_to_1000"
        | "above_1000"
        | "not_applicable";
      document_audit_action:
        | "document_created"
        | "version_uploaded"
        | "version_activated"
        | "version_deactivated"
        | "version_viewed"
        | "version_downloaded";
      document_category: "normative" | "communication";
      document_version_status: "active" | "inactive";
      lead_status: "new" | "in_contact" | "qualified" | "discarded";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "ceo", "pm", "tech_lead", "comercial", "financeiro", "viewer"],
      chat_contact_channel: ["whatsapp", "phone", "email"],
      chat_contact_profile: ["producer", "member", "supplier"],
      chat_contact_time: ["morning", "afternoon", "evening", "any"],
      chat_conversation_status: ["active", "completed", "handoff", "declined", "abandoned"],
      chat_flow_key: ["csp"],
      chat_message_role: ["user", "bot"],
      csp_interest: ["input", "feed", "logistics", "information"],
      csp_volume_range: [
        "up_to_50",
        "from_50_to_200",
        "from_200_to_1000",
        "above_1000",
        "not_applicable",
      ],
      document_audit_action: [
        "document_created",
        "version_uploaded",
        "version_activated",
        "version_deactivated",
        "version_viewed",
        "version_downloaded",
      ],
      document_category: ["normative", "communication"],
      document_version_status: ["active", "inactive"],
      lead_status: ["new", "in_contact", "qualified", "discarded"],
    },
  },
} as const;
