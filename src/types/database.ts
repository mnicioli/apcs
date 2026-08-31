export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
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
      admin_audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["admin_audit_action"];
          actor_id: string | null;
          actor_name: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          target: string | null;
        };
        Insert: {
          action: Database["public"]["Enums"]["admin_audit_action"];
          actor_id?: string | null;
          actor_name?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          target?: string | null;
        };
        Update: {
          action?: Database["public"]["Enums"]["admin_audit_action"];
          actor_id?: string | null;
          actor_name?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          target?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "admin_audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      app_role_ceilings: {
        Row: {
          base_role: Database["public"]["Enums"]["app_role"];
          permission: string;
        };
        Insert: {
          base_role: Database["public"]["Enums"]["app_role"];
          permission: string;
        };
        Update: {
          base_role?: Database["public"]["Enums"]["app_role"];
          permission?: string;
        };
        Relationships: [];
      };
      app_role_permissions: {
        Row: {
          permission: string;
          role_key: string;
        };
        Insert: {
          permission: string;
          role_key: string;
        };
        Update: {
          permission?: string;
          role_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: "app_role_permissions_role_key_fkey";
            columns: ["role_key"];
            isOneToOne: false;
            referencedRelation: "app_roles";
            referencedColumns: ["key"];
          },
        ];
      };
      app_roles: {
        Row: {
          base_role: Database["public"]["Enums"]["app_role"];
          created_at: string;
          created_by: string | null;
          description: string | null;
          is_builtin: boolean;
          key: string;
          label: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          base_role: Database["public"]["Enums"]["app_role"];
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          is_builtin?: boolean;
          key: string;
          label: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          base_role?: Database["public"]["Enums"]["app_role"];
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          is_builtin?: boolean;
          key?: string;
          label?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "app_roles_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      app_settings: {
        Row: {
          key: string;
          updated_at: string;
          updated_by: string | null;
          value: string;
        };
        Insert: {
          key: string;
          updated_at?: string;
          updated_by?: string | null;
          value: string;
        };
        Update: {
          key?: string;
          updated_at?: string;
          updated_by?: string | null;
          value?: string;
        };
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      broadcast_recipients: {
        Row: {
          attempts: number;
          broadcast_id: string;
          created_at: string;
          id: string;
          last_attempt_at: string | null;
          last_error: string | null;
          member_id: string | null;
          member_name: string | null;
          member_phone: string;
          provider_message_id: string | null;
          status: Database["public"]["Enums"]["broadcast_recipient_status"];
        };
        Insert: {
          attempts?: number;
          broadcast_id: string;
          created_at?: string;
          id?: string;
          last_attempt_at?: string | null;
          last_error?: string | null;
          member_id?: string | null;
          member_name?: string | null;
          member_phone: string;
          provider_message_id?: string | null;
          status?: Database["public"]["Enums"]["broadcast_recipient_status"];
        };
        Update: {
          attempts?: number;
          broadcast_id?: string;
          created_at?: string;
          id?: string;
          last_attempt_at?: string | null;
          last_error?: string | null;
          member_id?: string | null;
          member_name?: string | null;
          member_phone?: string;
          provider_message_id?: string | null;
          status?: Database["public"]["Enums"]["broadcast_recipient_status"];
        };
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey";
            columns: ["broadcast_id"];
            isOneToOne: false;
            referencedRelation: "broadcasts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcast_recipients_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      broadcast_segments: {
        Row: {
          broadcast_id: string;
          segment_id: string;
        };
        Insert: {
          broadcast_id: string;
          segment_id: string;
        };
        Update: {
          broadcast_id?: string;
          segment_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "broadcast_segments_broadcast_id_fkey";
            columns: ["broadcast_id"];
            isOneToOne: false;
            referencedRelation: "broadcasts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcast_segments_segment_id_fkey";
            columns: ["segment_id"];
            isOneToOne: false;
            referencedRelation: "event_segments";
            referencedColumns: ["id"];
          },
        ];
      };
      broadcasts: {
        Row: {
          body: string;
          created_by: string | null;
          created_by_name: string | null;
          finished_at: string | null;
          id: string;
          image_bucket: string | null;
          image_filename: string | null;
          image_mime: string | null;
          image_path: string | null;
          last_error: string | null;
          media_bucket: string | null;
          media_filename: string | null;
          media_mime: string | null;
          media_path: string | null;
          source: Database["public"]["Enums"]["broadcast_source"];
          source_id: string;
          started_at: string;
          status: Database["public"]["Enums"]["broadcast_status"];
          title: string;
          total_blocked: number;
          total_errors: number;
          total_recipients: number;
          total_sent: number;
        };
        Insert: {
          body: string;
          created_by?: string | null;
          created_by_name?: string | null;
          finished_at?: string | null;
          id?: string;
          image_bucket?: string | null;
          image_filename?: string | null;
          image_mime?: string | null;
          image_path?: string | null;
          last_error?: string | null;
          media_bucket?: string | null;
          media_filename?: string | null;
          media_mime?: string | null;
          media_path?: string | null;
          source: Database["public"]["Enums"]["broadcast_source"];
          source_id: string;
          started_at?: string;
          status?: Database["public"]["Enums"]["broadcast_status"];
          title: string;
          total_blocked?: number;
          total_errors?: number;
          total_recipients?: number;
          total_sent?: number;
        };
        Update: {
          body?: string;
          created_by?: string | null;
          created_by_name?: string | null;
          finished_at?: string | null;
          id?: string;
          image_bucket?: string | null;
          image_filename?: string | null;
          image_mime?: string | null;
          image_path?: string | null;
          last_error?: string | null;
          media_bucket?: string | null;
          media_filename?: string | null;
          media_mime?: string | null;
          media_path?: string | null;
          source?: Database["public"]["Enums"]["broadcast_source"];
          source_id?: string;
          started_at?: string;
          status?: Database["public"]["Enums"]["broadcast_status"];
          title?: string;
          total_blocked?: number;
          total_errors?: number;
          total_recipients?: number;
          total_sent?: number;
        };
        Relationships: [
          {
            foreignKeyName: "broadcasts_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
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
      consent_texts: {
        Row: {
          body: string;
          created_at: string;
          created_by: string | null;
          version: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          created_by?: string | null;
          version: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          created_by?: string | null;
          version?: string;
        };
        Relationships: [
          {
            foreignKeyName: "consent_texts_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      conversation_context: {
        Row: {
          current_intent: string | null;
          current_subject: string | null;
          expires_at: string | null;
          menu_shown_at: string | null;
          pending_intent: string | null;
          pending_subject: string | null;
          updated_at: string;
          whatsapp_chat_id: string;
        };
        Insert: {
          current_intent?: string | null;
          current_subject?: string | null;
          expires_at?: string | null;
          menu_shown_at?: string | null;
          pending_intent?: string | null;
          pending_subject?: string | null;
          updated_at?: string;
          whatsapp_chat_id: string;
        };
        Update: {
          current_intent?: string | null;
          current_subject?: string | null;
          expires_at?: string | null;
          menu_shown_at?: string | null;
          pending_intent?: string | null;
          pending_subject?: string | null;
          updated_at?: string;
          whatsapp_chat_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversation_context_whatsapp_chat_id_fkey";
            columns: ["whatsapp_chat_id"];
            isOneToOne: true;
            referencedRelation: "whatsapp_chats";
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
      event_audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["event_audit_action"];
          actor_id: string | null;
          created_at: string;
          event_id: string | null;
          id: number;
          metadata: Json;
        };
        Insert: {
          action: Database["public"]["Enums"]["event_audit_action"];
          actor_id?: string | null;
          created_at?: string;
          event_id?: string | null;
          id?: never;
          metadata?: Json;
        };
        Update: {
          action?: Database["public"]["Enums"]["event_audit_action"];
          actor_id?: string | null;
          created_at?: string;
          event_id?: string | null;
          id?: never;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "event_audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_audit_logs_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      event_dispatches: {
        Row: {
          created_by: string | null;
          event_id: string;
          finished_at: string | null;
          id: string;
          last_error: string | null;
          started_at: string;
          status: Database["public"]["Enums"]["event_dispatch_status"];
          total_blocked: number;
          total_errors: number;
          total_recipients: number;
          total_sent: number;
        };
        Insert: {
          created_by?: string | null;
          event_id: string;
          finished_at?: string | null;
          id?: string;
          last_error?: string | null;
          started_at?: string;
          status?: Database["public"]["Enums"]["event_dispatch_status"];
          total_blocked?: number;
          total_errors?: number;
          total_recipients?: number;
          total_sent?: number;
        };
        Update: {
          created_by?: string | null;
          event_id?: string;
          finished_at?: string | null;
          id?: string;
          last_error?: string | null;
          started_at?: string;
          status?: Database["public"]["Enums"]["event_dispatch_status"];
          total_blocked?: number;
          total_errors?: number;
          total_recipients?: number;
          total_sent?: number;
        };
        Relationships: [
          {
            foreignKeyName: "event_dispatches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_dispatches_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      event_recipients: {
        Row: {
          attempts: number;
          created_at: string;
          event_id: string;
          id: string;
          last_attempt_at: string | null;
          last_dispatch_id: string | null;
          last_error: string | null;
          member_id: string | null;
          member_name: string | null;
          member_phone: string;
          provider_message_id: string | null;
          status: Database["public"]["Enums"]["event_recipient_status"];
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          event_id: string;
          id?: string;
          last_attempt_at?: string | null;
          last_dispatch_id?: string | null;
          last_error?: string | null;
          member_id?: string | null;
          member_name?: string | null;
          member_phone: string;
          provider_message_id?: string | null;
          status?: Database["public"]["Enums"]["event_recipient_status"];
        };
        Update: {
          attempts?: number;
          created_at?: string;
          event_id?: string;
          id?: string;
          last_attempt_at?: string | null;
          last_dispatch_id?: string | null;
          last_error?: string | null;
          member_id?: string | null;
          member_name?: string | null;
          member_phone?: string;
          provider_message_id?: string | null;
          status?: Database["public"]["Enums"]["event_recipient_status"];
        };
        Relationships: [
          {
            foreignKeyName: "event_recipients_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_recipients_last_dispatch_id_fkey";
            columns: ["last_dispatch_id"];
            isOneToOne: false;
            referencedRelation: "event_dispatches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_recipients_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      event_segment_links: {
        Row: {
          created_at: string;
          event_id: string;
          segment_id: string;
        };
        Insert: {
          created_at?: string;
          event_id: string;
          segment_id: string;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          segment_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_segment_links_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "event_segment_links_segment_id_fkey";
            columns: ["segment_id"];
            isOneToOne: false;
            referencedRelation: "event_segments";
            referencedColumns: ["id"];
          },
        ];
      };
      event_segments: {
        Row: {
          active: boolean;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          slug: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          slug: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      events: {
        Row: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          end_time: string | null;
          event_date: string;
          id: string;
          image_mime: string;
          image_path: string;
          image_size_bytes: number;
          location: string;
          name: string;
          registration_url: string | null;
          start_time: string;
          status: Database["public"]["Enums"]["event_status"];
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          end_time?: string | null;
          event_date: string;
          id?: string;
          image_mime: string;
          image_path: string;
          image_size_bytes: number;
          location: string;
          name: string;
          registration_url?: string | null;
          start_time: string;
          status?: Database["public"]["Enums"]["event_status"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          end_time?: string | null;
          event_date?: string;
          id?: string;
          image_mime?: string;
          image_path?: string;
          image_size_bytes?: number;
          location?: string;
          name?: string;
          registration_url?: string | null;
          start_time?: string;
          status?: Database["public"]["Enums"]["event_status"];
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "events_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      intelligence_interactions: {
        Row: {
          confidence: number | null;
          correlation_id: string | null;
          created_at: string;
          id: number;
          input_tokens: number | null;
          intent: string;
          latency_ms: number | null;
          model: string | null;
          outcome: Database["public"]["Enums"]["intelligence_outcome"];
          output_tokens: number | null;
          prompt_version: string | null;
          reply_message_id: string | null;
          source_id: string | null;
          source_type: string | null;
          subject: string | null;
          tool: string | null;
          whatsapp_chat_id: string | null;
          whatsapp_message_id: string | null;
        };
        Insert: {
          confidence?: number | null;
          correlation_id?: string | null;
          created_at?: string;
          id?: never;
          input_tokens?: number | null;
          intent: string;
          latency_ms?: number | null;
          model?: string | null;
          outcome: Database["public"]["Enums"]["intelligence_outcome"];
          output_tokens?: number | null;
          prompt_version?: string | null;
          reply_message_id?: string | null;
          source_id?: string | null;
          source_type?: string | null;
          subject?: string | null;
          tool?: string | null;
          whatsapp_chat_id?: string | null;
          whatsapp_message_id?: string | null;
        };
        Update: {
          confidence?: number | null;
          correlation_id?: string | null;
          created_at?: string;
          id?: never;
          input_tokens?: number | null;
          intent?: string;
          latency_ms?: number | null;
          model?: string | null;
          outcome?: Database["public"]["Enums"]["intelligence_outcome"];
          output_tokens?: number | null;
          prompt_version?: string | null;
          reply_message_id?: string | null;
          source_id?: string | null;
          source_type?: string | null;
          subject?: string | null;
          tool?: string | null;
          whatsapp_chat_id?: string | null;
          whatsapp_message_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "intelligence_interactions_reply_message_id_fkey";
            columns: ["reply_message_id"];
            isOneToOne: false;
            referencedRelation: "whatsapp_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "intelligence_interactions_whatsapp_chat_id_fkey";
            columns: ["whatsapp_chat_id"];
            isOneToOne: false;
            referencedRelation: "whatsapp_chats";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "intelligence_interactions_whatsapp_message_id_fkey";
            columns: ["whatsapp_message_id"];
            isOneToOne: false;
            referencedRelation: "whatsapp_messages";
            referencedColumns: ["id"];
          },
        ];
      };
      knowledge_categories: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          name_key: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          name_key?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          name_key?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "knowledge_categories_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      knowledge_entries: {
        Row: {
          available_for_chatbot: boolean;
          category_id: string;
          content: string;
          created_at: string;
          created_by: string | null;
          ends_at: string | null;
          id: string;
          keywords: string[];
          starts_at: string | null;
          status: Database["public"]["Enums"]["knowledge_status"];
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          available_for_chatbot?: boolean;
          category_id: string;
          content: string;
          created_at?: string;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          keywords?: string[];
          starts_at?: string | null;
          status?: Database["public"]["Enums"]["knowledge_status"];
          title: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          available_for_chatbot?: boolean;
          category_id?: string;
          content?: string;
          created_at?: string;
          created_by?: string | null;
          ends_at?: string | null;
          id?: string;
          keywords?: string[];
          starts_at?: string | null;
          status?: Database["public"]["Enums"]["knowledge_status"];
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "knowledge_entries_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_entries_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_entries_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      lecture_audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["lecture_audit_action"];
          actor_id: string | null;
          created_at: string;
          id: number;
          lecture_id: string | null;
          metadata: Json;
        };
        Insert: {
          action: Database["public"]["Enums"]["lecture_audit_action"];
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          lecture_id?: string | null;
          metadata?: Json;
        };
        Update: {
          action?: Database["public"]["Enums"]["lecture_audit_action"];
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          lecture_id?: string | null;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "lecture_audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lecture_audit_logs_lecture_id_fkey";
            columns: ["lecture_id"];
            isOneToOne: false;
            referencedRelation: "lectures";
            referencedColumns: ["id"];
          },
        ];
      };
      lecture_cities: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          name: string;
          name_key: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name: string;
          name_key?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name?: string;
          name_key?: string | null;
        };
        Relationships: [];
      };
      lecture_speakers: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          name_key: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          name_key?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          name_key?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "lecture_speakers_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      lecture_status_transitions: {
        Row: {
          created_at: string;
          from_status: Database["public"]["Enums"]["lecture_status"] | null;
          to_status: Database["public"]["Enums"]["lecture_status"];
        };
        Insert: {
          created_at?: string;
          from_status?: Database["public"]["Enums"]["lecture_status"] | null;
          to_status: Database["public"]["Enums"]["lecture_status"];
        };
        Update: {
          created_at?: string;
          from_status?: Database["public"]["Enums"]["lecture_status"] | null;
          to_status?: Database["public"]["Enums"]["lecture_status"];
        };
        Relationships: [];
      };
      lectures: {
        Row: {
          attendees_actual: number | null;
          attendees_estimated: number | null;
          cancellation_reason: string | null;
          city: string;
          created_at: string;
          created_by: string | null;
          end_time: string | null;
          event_date: string;
          format: Database["public"]["Enums"]["lecture_format"] | null;
          held_at: string | null;
          id: string;
          idempotency_key: string | null;
          location: string | null;
          name: string;
          notes: string | null;
          origin: Database["public"]["Enums"]["lecture_origin"];
          outcome_notes: string | null;
          priority: Database["public"]["Enums"]["lecture_priority"];
          protocol: string;
          rejection_reason: string | null;
          requested_at: string;
          requester_contact_id: string | null;
          requester_email: string | null;
          requester_name: string | null;
          requester_organization: string | null;
          requester_phone: string | null;
          responsible_id: string | null;
          search_text: string | null;
          speaker_catalog_id: string | null;
          speaker_id: string | null;
          start_time: string | null;
          status: Database["public"]["Enums"]["lecture_status"];
          theme: string;
          type: Database["public"]["Enums"]["lecture_type"];
          type_other: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          attendees_actual?: number | null;
          attendees_estimated?: number | null;
          cancellation_reason?: string | null;
          city: string;
          created_at?: string;
          created_by?: string | null;
          end_time?: string | null;
          event_date: string;
          format?: Database["public"]["Enums"]["lecture_format"] | null;
          held_at?: string | null;
          id?: string;
          idempotency_key?: string | null;
          location?: string | null;
          name: string;
          notes?: string | null;
          origin: Database["public"]["Enums"]["lecture_origin"];
          outcome_notes?: string | null;
          priority?: Database["public"]["Enums"]["lecture_priority"];
          protocol?: string;
          rejection_reason?: string | null;
          requested_at?: string;
          requester_contact_id?: string | null;
          requester_email?: string | null;
          requester_name?: string | null;
          requester_organization?: string | null;
          requester_phone?: string | null;
          responsible_id?: string | null;
          search_text?: string | null;
          speaker_catalog_id?: string | null;
          speaker_id?: string | null;
          start_time?: string | null;
          status: Database["public"]["Enums"]["lecture_status"];
          theme: string;
          type: Database["public"]["Enums"]["lecture_type"];
          type_other?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          attendees_actual?: number | null;
          attendees_estimated?: number | null;
          cancellation_reason?: string | null;
          city?: string;
          created_at?: string;
          created_by?: string | null;
          end_time?: string | null;
          event_date?: string;
          format?: Database["public"]["Enums"]["lecture_format"] | null;
          held_at?: string | null;
          id?: string;
          idempotency_key?: string | null;
          location?: string | null;
          name?: string;
          notes?: string | null;
          origin?: Database["public"]["Enums"]["lecture_origin"];
          outcome_notes?: string | null;
          priority?: Database["public"]["Enums"]["lecture_priority"];
          protocol?: string;
          rejection_reason?: string | null;
          requested_at?: string;
          requester_contact_id?: string | null;
          requester_email?: string | null;
          requester_name?: string | null;
          requester_organization?: string | null;
          requester_phone?: string | null;
          responsible_id?: string | null;
          search_text?: string | null;
          speaker_catalog_id?: string | null;
          speaker_id?: string | null;
          start_time?: string | null;
          status?: Database["public"]["Enums"]["lecture_status"];
          theme?: string;
          type?: Database["public"]["Enums"]["lecture_type"];
          type_other?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "lectures_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lectures_requester_contact_id_fkey";
            columns: ["requester_contact_id"];
            isOneToOne: false;
            referencedRelation: "chat_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lectures_responsible_id_fkey";
            columns: ["responsible_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lectures_speaker_catalog_id_fkey";
            columns: ["speaker_catalog_id"];
            isOneToOne: false;
            referencedRelation: "lecture_speakers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lectures_speaker_id_fkey";
            columns: ["speaker_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lectures_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      market_bulletin_audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["market_bulletin_audit_action"];
          actor_id: string | null;
          bulletin_id: string | null;
          created_at: string;
          id: number;
          metadata: Json;
          version_id: string | null;
        };
        Insert: {
          action: Database["public"]["Enums"]["market_bulletin_audit_action"];
          actor_id?: string | null;
          bulletin_id?: string | null;
          created_at?: string;
          id?: never;
          metadata?: Json;
          version_id?: string | null;
        };
        Update: {
          action?: Database["public"]["Enums"]["market_bulletin_audit_action"];
          actor_id?: string | null;
          bulletin_id?: string | null;
          created_at?: string;
          id?: never;
          metadata?: Json;
          version_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "market_bulletin_audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "market_bulletin_audit_logs_bulletin_id_fkey";
            columns: ["bulletin_id"];
            isOneToOne: false;
            referencedRelation: "market_bulletins";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "market_bulletin_audit_logs_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "market_bulletin_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      market_bulletin_versions: {
        Row: {
          activated_at: string | null;
          activated_by: string | null;
          bulletin_id: string;
          deactivated_at: string | null;
          deactivated_by: string | null;
          effective_date: string;
          id: string;
          image_filename: string;
          image_mime_type: string;
          image_path: string;
          image_size_bytes: number;
          pdf_filename: string;
          pdf_mime_type: string;
          pdf_path: string;
          pdf_size_bytes: number;
          status: Database["public"]["Enums"]["market_bulletin_version_status"];
          status_reason: Database["public"]["Enums"]["market_bulletin_status_reason"] | null;
          uploaded_at: string;
          uploaded_by: string | null;
          version: number;
          version_name: string;
        };
        Insert: {
          activated_at?: string | null;
          activated_by?: string | null;
          bulletin_id: string;
          deactivated_at?: string | null;
          deactivated_by?: string | null;
          effective_date: string;
          id: string;
          image_filename: string;
          image_mime_type: string;
          image_path: string;
          image_size_bytes: number;
          pdf_filename: string;
          pdf_mime_type?: string;
          pdf_path: string;
          pdf_size_bytes: number;
          status: Database["public"]["Enums"]["market_bulletin_version_status"];
          status_reason?: Database["public"]["Enums"]["market_bulletin_status_reason"] | null;
          uploaded_at?: string;
          uploaded_by?: string | null;
          version: number;
          version_name: string;
        };
        Update: {
          activated_at?: string | null;
          activated_by?: string | null;
          bulletin_id?: string;
          deactivated_at?: string | null;
          deactivated_by?: string | null;
          effective_date?: string;
          id?: string;
          image_filename?: string;
          image_mime_type?: string;
          image_path?: string;
          image_size_bytes?: number;
          pdf_filename?: string;
          pdf_mime_type?: string;
          pdf_path?: string;
          pdf_size_bytes?: number;
          status?: Database["public"]["Enums"]["market_bulletin_version_status"];
          status_reason?: Database["public"]["Enums"]["market_bulletin_status_reason"] | null;
          uploaded_at?: string;
          uploaded_by?: string | null;
          version?: number;
          version_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "market_bulletin_versions_activated_by_fkey";
            columns: ["activated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "market_bulletin_versions_bulletin_id_fkey";
            columns: ["bulletin_id"];
            isOneToOne: false;
            referencedRelation: "market_bulletins";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "market_bulletin_versions_deactivated_by_fkey";
            columns: ["deactivated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "market_bulletin_versions_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      market_bulletins: {
        Row: {
          chatbot_enabled: boolean;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          name: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          chatbot_enabled?: boolean;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          chatbot_enabled?: boolean;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "market_bulletins_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "market_bulletins_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      members: {
        Row: {
          activity_area: string | null;
          city: string | null;
          cnpj: string | null;
          code: string | null;
          contact_id: string | null;
          created_at: string;
          created_by: string | null;
          email: string | null;
          external_id: string | null;
          farm_name: string | null;
          full_name: string;
          id: string;
          interests: string[];
          job_title: string | null;
          joined_at: string | null;
          legal_name: string | null;
          notes: string | null;
          organization: string | null;
          origin: Database["public"]["Enums"]["member_origin"];
          other_interest: string | null;
          production_city: string | null;
          profile_type: Database["public"]["Enums"]["membership_profile_type"] | null;
          sow_count: number | null;
          state: string | null;
          state_registration: string | null;
          status: Database["public"]["Enums"]["member_status"];
          trade_name: string | null;
          updated_at: string;
          updated_by: string | null;
          whatsapp: string | null;
        };
        Insert: {
          activity_area?: string | null;
          city?: string | null;
          cnpj?: string | null;
          code?: string | null;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          external_id?: string | null;
          farm_name?: string | null;
          full_name: string;
          id?: string;
          interests?: string[];
          job_title?: string | null;
          joined_at?: string | null;
          legal_name?: string | null;
          notes?: string | null;
          organization?: string | null;
          origin: Database["public"]["Enums"]["member_origin"];
          other_interest?: string | null;
          production_city?: string | null;
          profile_type?: Database["public"]["Enums"]["membership_profile_type"] | null;
          sow_count?: number | null;
          state?: string | null;
          state_registration?: string | null;
          status?: Database["public"]["Enums"]["member_status"];
          trade_name?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          whatsapp?: string | null;
        };
        Update: {
          activity_area?: string | null;
          city?: string | null;
          cnpj?: string | null;
          code?: string | null;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          external_id?: string | null;
          farm_name?: string | null;
          full_name?: string;
          id?: string;
          interests?: string[];
          job_title?: string | null;
          joined_at?: string | null;
          legal_name?: string | null;
          notes?: string | null;
          organization?: string | null;
          origin?: Database["public"]["Enums"]["member_origin"];
          other_interest?: string | null;
          production_city?: string | null;
          profile_type?: Database["public"]["Enums"]["membership_profile_type"] | null;
          sow_count?: number | null;
          state?: string | null;
          state_registration?: string | null;
          status?: Database["public"]["Enums"]["member_status"];
          trade_name?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          whatsapp?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "members_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "chat_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "members_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "members_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      membership_application_status_transitions: {
        Row: {
          created_at: string;
          from_status: Database["public"]["Enums"]["membership_application_status"] | null;
          to_status: Database["public"]["Enums"]["membership_application_status"];
        };
        Insert: {
          created_at?: string;
          from_status?: Database["public"]["Enums"]["membership_application_status"] | null;
          to_status: Database["public"]["Enums"]["membership_application_status"];
        };
        Update: {
          created_at?: string;
          from_status?: Database["public"]["Enums"]["membership_application_status"] | null;
          to_status?: Database["public"]["Enums"]["membership_application_status"];
        };
        Relationships: [];
      };
      membership_applications: {
        Row: {
          activity_area: string | null;
          city: string;
          cnpj: string | null;
          consent_accepted: boolean;
          consent_at: string;
          consent_policy_version: string | null;
          created_at: string;
          dedupe_key: string;
          email: string;
          farm_name: string | null;
          full_name: string;
          id: string;
          interests: string[];
          job_title: string | null;
          legal_name: string | null;
          member_id: string | null;
          organization: string | null;
          other_interest: string | null;
          production_city: string | null;
          profile_type: Database["public"]["Enums"]["membership_profile_type"];
          protocol: string;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source_ip_hash: string | null;
          sow_count: number | null;
          state: string;
          state_registration: string | null;
          status: Database["public"]["Enums"]["membership_application_status"];
          trade_name: string | null;
          updated_at: string;
          user_agent: string | null;
          whatsapp: string;
        };
        Insert: {
          activity_area?: string | null;
          city: string;
          cnpj?: string | null;
          consent_accepted: boolean;
          consent_at?: string;
          consent_policy_version?: string | null;
          created_at?: string;
          dedupe_key: string;
          email: string;
          farm_name?: string | null;
          full_name: string;
          id?: string;
          interests?: string[];
          job_title?: string | null;
          legal_name?: string | null;
          member_id?: string | null;
          organization?: string | null;
          other_interest?: string | null;
          production_city?: string | null;
          profile_type: Database["public"]["Enums"]["membership_profile_type"];
          protocol?: string;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source_ip_hash?: string | null;
          sow_count?: number | null;
          state: string;
          state_registration?: string | null;
          status?: Database["public"]["Enums"]["membership_application_status"];
          trade_name?: string | null;
          updated_at?: string;
          user_agent?: string | null;
          whatsapp: string;
        };
        Update: {
          activity_area?: string | null;
          city?: string;
          cnpj?: string | null;
          consent_accepted?: boolean;
          consent_at?: string;
          consent_policy_version?: string | null;
          created_at?: string;
          dedupe_key?: string;
          email?: string;
          farm_name?: string | null;
          full_name?: string;
          id?: string;
          interests?: string[];
          job_title?: string | null;
          legal_name?: string | null;
          member_id?: string | null;
          organization?: string | null;
          other_interest?: string | null;
          production_city?: string | null;
          profile_type?: Database["public"]["Enums"]["membership_profile_type"];
          protocol?: string;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source_ip_hash?: string | null;
          sow_count?: number | null;
          state?: string;
          state_registration?: string | null;
          status?: Database["public"]["Enums"]["membership_application_status"];
          trade_name?: string | null;
          updated_at?: string;
          user_agent?: string | null;
          whatsapp?: string;
        };
        Relationships: [
          {
            foreignKeyName: "membership_applications_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "membership_applications_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      membership_audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["membership_audit_action"];
          actor_id: string | null;
          actor_name: string | null;
          application_id: string | null;
          created_at: string;
          id: string;
          member_id: string | null;
          metadata: Json;
        };
        Insert: {
          action: Database["public"]["Enums"]["membership_audit_action"];
          actor_id?: string | null;
          actor_name?: string | null;
          application_id?: string | null;
          created_at?: string;
          id?: string;
          member_id?: string | null;
          metadata?: Json;
        };
        Update: {
          action?: Database["public"]["Enums"]["membership_audit_action"];
          actor_id?: string | null;
          actor_name?: string | null;
          application_id?: string | null;
          created_at?: string;
          id?: string;
          member_id?: string | null;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "membership_audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "membership_audit_logs_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "membership_applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "membership_audit_logs_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_opt_outs: {
        Row: {
          channel: Database["public"]["Enums"]["survey_channel"];
          contact_id: string | null;
          created_at: string;
          id: string;
          note: string | null;
          phone_key: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          revoked_note: string | null;
          source: string;
        };
        Insert: {
          channel: Database["public"]["Enums"]["survey_channel"];
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          note?: string | null;
          phone_key?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          revoked_note?: string | null;
          source: string;
        };
        Update: {
          channel?: Database["public"]["Enums"]["survey_channel"];
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          note?: string | null;
          phone_key?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          revoked_note?: string | null;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_opt_outs_revoked_by_fkey";
            columns: ["revoked_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "survey_opt_outs_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "chat_contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          active: boolean;
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          role_key: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          avatar_url?: string | null;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          role?: Database["public"]["Enums"]["app_role"];
          role_key?: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          avatar_url?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          role_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_role_key_fkey";
            columns: ["role_key"];
            isOneToOne: false;
            referencedRelation: "app_roles";
            referencedColumns: ["key"];
          },
        ];
      };
      survey_audience_criteria: {
        Row: {
          contact_id: string | null;
          created_at: string;
          dimension: Database["public"]["Enums"]["survey_audience_dimension"];
          id: string;
          segment_id: string | null;
          survey_id: string;
          value: string | null;
        };
        Insert: {
          contact_id?: string | null;
          created_at?: string;
          dimension: Database["public"]["Enums"]["survey_audience_dimension"];
          id?: string;
          segment_id?: string | null;
          survey_id: string;
          value?: string | null;
        };
        Update: {
          contact_id?: string | null;
          created_at?: string;
          dimension?: Database["public"]["Enums"]["survey_audience_dimension"];
          id?: string;
          segment_id?: string | null;
          survey_id?: string;
          value?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "survey_audience_criteria_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "chat_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "survey_audience_criteria_segment_id_fkey";
            columns: ["segment_id"];
            isOneToOne: false;
            referencedRelation: "event_segments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "survey_audience_criteria_survey_id_fkey";
            columns: ["survey_id"];
            isOneToOne: false;
            referencedRelation: "surveys";
            referencedColumns: ["id"];
          },
        ];
      };
      survey_audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["survey_audit_action"];
          actor_id: string | null;
          created_at: string;
          id: number;
          metadata: Json;
          survey_id: string | null;
        };
        Insert: {
          action: Database["public"]["Enums"]["survey_audit_action"];
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          metadata?: Json;
          survey_id?: string | null;
        };
        Update: {
          action?: Database["public"]["Enums"]["survey_audit_action"];
          actor_id?: string | null;
          created_at?: string;
          id?: never;
          metadata?: Json;
          survey_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "survey_audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "survey_audit_logs_survey_id_fkey";
            columns: ["survey_id"];
            isOneToOne: false;
            referencedRelation: "surveys";
            referencedColumns: ["id"];
          },
        ];
      };
      survey_conversation_states: {
        Row: {
          asked_at: string;
          channel: Database["public"]["Enums"]["survey_channel"];
          cleared_at: string | null;
          cleared_reason: string | null;
          contact_id: string;
          created_at: string;
          expires_at: string | null;
          id: string;
          invalid_attempts: number;
          provider_message_id: string | null;
          question_id: string;
          recipient_id: string | null;
          status: Database["public"]["Enums"]["survey_context_status"];
          survey_id: string;
          updated_at: string;
        };
        Insert: {
          asked_at?: string;
          channel: Database["public"]["Enums"]["survey_channel"];
          cleared_at?: string | null;
          cleared_reason?: string | null;
          contact_id: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          invalid_attempts?: number;
          provider_message_id?: string | null;
          question_id: string;
          recipient_id?: string | null;
          status?: Database["public"]["Enums"]["survey_context_status"];
          survey_id: string;
          updated_at?: string;
        };
        Update: {
          asked_at?: string;
          channel?: Database["public"]["Enums"]["survey_channel"];
          cleared_at?: string | null;
          cleared_reason?: string | null;
          contact_id?: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          invalid_attempts?: number;
          provider_message_id?: string | null;
          question_id?: string;
          recipient_id?: string | null;
          status?: Database["public"]["Enums"]["survey_context_status"];
          survey_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "survey_conversation_states_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "chat_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "survey_conversation_states_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "survey_questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "survey_conversation_states_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "survey_recipients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "survey_conversation_states_survey_id_fkey";
            columns: ["survey_id"];
            isOneToOne: false;
            referencedRelation: "surveys";
            referencedColumns: ["id"];
          },
        ];
      };
      survey_dispatches: {
        Row: {
          created_by: string | null;
          finished_at: string | null;
          id: string;
          last_error: string | null;
          started_at: string;
          status: Database["public"]["Enums"]["survey_dispatch_status"];
          survey_id: string;
          total_errors: number;
          total_recipients: number;
          total_sent: number;
        };
        Insert: {
          created_by?: string | null;
          finished_at?: string | null;
          id?: string;
          last_error?: string | null;
          started_at?: string;
          status?: Database["public"]["Enums"]["survey_dispatch_status"];
          survey_id: string;
          total_errors?: number;
          total_recipients?: number;
          total_sent?: number;
        };
        Update: {
          created_by?: string | null;
          finished_at?: string | null;
          id?: string;
          last_error?: string | null;
          started_at?: string;
          status?: Database["public"]["Enums"]["survey_dispatch_status"];
          survey_id?: string;
          total_errors?: number;
          total_recipients?: number;
          total_sent?: number;
        };
        Relationships: [
          {
            foreignKeyName: "survey_dispatches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "survey_dispatches_survey_id_fkey";
            columns: ["survey_id"];
            isOneToOne: false;
            referencedRelation: "surveys";
            referencedColumns: ["id"];
          },
        ];
      };
      survey_inbound_events: {
        Row: {
          contact_id: string | null;
          correlation_id: string | null;
          event_type: string;
          id: number;
          outcome: string | null;
          processed_at: string | null;
          provider: string;
          provider_event_id: string;
          received_at: string;
          survey_id: string | null;
        };
        Insert: {
          contact_id?: string | null;
          correlation_id?: string | null;
          event_type: string;
          id?: never;
          outcome?: string | null;
          processed_at?: string | null;
          provider: string;
          provider_event_id: string;
          received_at?: string;
          survey_id?: string | null;
        };
        Update: {
          contact_id?: string | null;
          correlation_id?: string | null;
          event_type?: string;
          id?: never;
          outcome?: string | null;
          processed_at?: string | null;
          provider?: string;
          provider_event_id?: string;
          received_at?: string;
          survey_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "survey_inbound_events_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "chat_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "survey_inbound_events_survey_id_fkey";
            columns: ["survey_id"];
            isOneToOne: false;
            referencedRelation: "surveys";
            referencedColumns: ["id"];
          },
        ];
      };
      survey_options: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          position: number;
          question_id: string;
          text: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          position: number;
          question_id: string;
          text: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          position?: number;
          question_id?: string;
          text?: string;
        };
        Relationships: [
          {
            foreignKeyName: "survey_options_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "survey_questions";
            referencedColumns: ["id"];
          },
        ];
      };
      survey_questions: {
        Row: {
          answer_type: Database["public"]["Enums"]["survey_answer_type"];
          created_at: string;
          id: string;
          position: number;
          required: boolean;
          survey_id: string;
          text: string;
        };
        Insert: {
          answer_type?: Database["public"]["Enums"]["survey_answer_type"];
          created_at?: string;
          id?: string;
          position?: number;
          required?: boolean;
          survey_id: string;
          text: string;
        };
        Update: {
          answer_type?: Database["public"]["Enums"]["survey_answer_type"];
          created_at?: string;
          id?: string;
          position?: number;
          required?: boolean;
          survey_id?: string;
          text?: string;
        };
        Relationships: [
          {
            foreignKeyName: "survey_questions_survey_id_fkey";
            columns: ["survey_id"];
            isOneToOne: false;
            referencedRelation: "surveys";
            referencedColumns: ["id"];
          },
        ];
      };
      survey_recipients: {
        Row: {
          attempts: number;
          contact_id: string | null;
          contact_name: string | null;
          contact_phone: string | null;
          created_at: string;
          id: string;
          last_attempt_at: string | null;
          last_dispatch_id: string | null;
          last_error: string | null;
          provider_message_id: string | null;
          status: Database["public"]["Enums"]["survey_recipient_status"];
          survey_id: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          contact_id?: string | null;
          contact_name?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          id?: string;
          last_attempt_at?: string | null;
          last_dispatch_id?: string | null;
          last_error?: string | null;
          provider_message_id?: string | null;
          status?: Database["public"]["Enums"]["survey_recipient_status"];
          survey_id: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          contact_id?: string | null;
          contact_name?: string | null;
          contact_phone?: string | null;
          created_at?: string;
          id?: string;
          last_attempt_at?: string | null;
          last_dispatch_id?: string | null;
          last_error?: string | null;
          provider_message_id?: string | null;
          status?: Database["public"]["Enums"]["survey_recipient_status"];
          survey_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "survey_recipients_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "chat_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "survey_recipients_last_dispatch_id_fkey";
            columns: ["last_dispatch_id"];
            isOneToOne: false;
            referencedRelation: "survey_dispatches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "survey_recipients_survey_id_fkey";
            columns: ["survey_id"];
            isOneToOne: false;
            referencedRelation: "surveys";
            referencedColumns: ["id"];
          },
        ];
      };
      survey_responses: {
        Row: {
          answered_at: string;
          contact_id: string;
          created_at: string;
          id: string;
          option_id: string;
          question_id: string;
          source_message_id: string | null;
          survey_id: string;
        };
        Insert: {
          answered_at?: string;
          contact_id: string;
          created_at?: string;
          id?: string;
          option_id: string;
          question_id: string;
          source_message_id?: string | null;
          survey_id: string;
        };
        Update: {
          answered_at?: string;
          contact_id?: string;
          created_at?: string;
          id?: string;
          option_id?: string;
          question_id?: string;
          source_message_id?: string | null;
          survey_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "survey_responses_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "chat_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "survey_responses_option_id_fkey";
            columns: ["option_id"];
            isOneToOne: false;
            referencedRelation: "survey_options";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "survey_responses_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "survey_questions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "survey_responses_survey_id_fkey";
            columns: ["survey_id"];
            isOneToOne: false;
            referencedRelation: "surveys";
            referencedColumns: ["id"];
          },
        ];
      };
      survey_status_transitions: {
        Row: {
          created_at: string;
          from_status: Database["public"]["Enums"]["survey_status"] | null;
          to_status: Database["public"]["Enums"]["survey_status"];
        };
        Insert: {
          created_at?: string;
          from_status?: Database["public"]["Enums"]["survey_status"] | null;
          to_status: Database["public"]["Enums"]["survey_status"];
        };
        Update: {
          created_at?: string;
          from_status?: Database["public"]["Enums"]["survey_status"] | null;
          to_status?: Database["public"]["Enums"]["survey_status"];
        };
        Relationships: [];
      };
      surveys: {
        Row: {
          allows_response_change: boolean;
          created_at: string;
          created_by: string | null;
          description: string | null;
          ends_at: string | null;
          id: string;
          image_mime: string | null;
          image_path: string | null;
          image_size_bytes: number | null;
          is_anonymous: boolean;
          scheduled_at: string | null;
          search_text: string | null;
          single_response_only: boolean;
          starts_at: string | null;
          status: Database["public"]["Enums"]["survey_status"];
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          allows_response_change?: boolean;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          ends_at?: string | null;
          id?: string;
          image_mime?: string | null;
          image_path?: string | null;
          image_size_bytes?: number | null;
          is_anonymous?: boolean;
          scheduled_at?: string | null;
          search_text?: string | null;
          single_response_only?: boolean;
          starts_at?: string | null;
          status: Database["public"]["Enums"]["survey_status"];
          title: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          allows_response_change?: boolean;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          ends_at?: string | null;
          id?: string;
          image_mime?: string | null;
          image_path?: string | null;
          image_size_bytes?: number | null;
          is_anonymous?: boolean;
          scheduled_at?: string | null;
          search_text?: string | null;
          single_response_only?: boolean;
          starts_at?: string | null;
          status?: Database["public"]["Enums"]["survey_status"];
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "surveys_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "surveys_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_chats: {
        Row: {
          archived: boolean;
          bot_paused_until: string | null;
          chat_key: string;
          contact_id: string | null;
          created_at: string;
          id: string;
          is_group: boolean;
          last_message_at: string | null;
          last_message_from_me: boolean | null;
          last_message_preview: string | null;
          member_id: string | null;
          name: string | null;
          phone: string | null;
          photo_url: string | null;
          provider: string;
          unread_count: number;
          updated_at: string;
        };
        Insert: {
          archived?: boolean;
          bot_paused_until?: string | null;
          chat_key: string;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          is_group?: boolean;
          last_message_at?: string | null;
          last_message_from_me?: boolean | null;
          last_message_preview?: string | null;
          member_id?: string | null;
          name?: string | null;
          phone?: string | null;
          photo_url?: string | null;
          provider: string;
          unread_count?: number;
          updated_at?: string;
        };
        Update: {
          archived?: boolean;
          bot_paused_until?: string | null;
          chat_key?: string;
          contact_id?: string | null;
          created_at?: string;
          id?: string;
          is_group?: boolean;
          last_message_at?: string | null;
          last_message_from_me?: boolean | null;
          last_message_preview?: string | null;
          member_id?: string | null;
          name?: string | null;
          phone?: string | null;
          photo_url?: string | null;
          provider?: string;
          unread_count?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_chats_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "chat_contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_chats_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_messages: {
        Row: {
          body: string;
          chat_id: string;
          created_at: string;
          delivered_at: string | null;
          direction: Database["public"]["Enums"]["whatsapp_direction"];
          error_message: string | null;
          id: string;
          kind: Database["public"]["Enums"]["whatsapp_message_kind"];
          media_duration_seconds: number | null;
          media_file_name: string | null;
          media_mime: string | null;
          media_path: string | null;
          media_size_bytes: number | null;
          media_status: Database["public"]["Enums"]["whatsapp_media_status"] | null;
          media_url: string | null;
          occurred_at: string;
          origin: Database["public"]["Enums"]["whatsapp_message_origin"];
          participant_phone: string | null;
          provider: string;
          provider_message_id: string | null;
          read_at: string | null;
          reply_to_provider_message_id: string | null;
          sender_name: string | null;
          sent_by: string | null;
          seq: number;
          status: Database["public"]["Enums"]["whatsapp_delivery_status"];
        };
        Insert: {
          body?: string;
          chat_id: string;
          created_at?: string;
          delivered_at?: string | null;
          direction: Database["public"]["Enums"]["whatsapp_direction"];
          error_message?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["whatsapp_message_kind"];
          media_duration_seconds?: number | null;
          media_file_name?: string | null;
          media_mime?: string | null;
          media_path?: string | null;
          media_size_bytes?: number | null;
          media_status?: Database["public"]["Enums"]["whatsapp_media_status"] | null;
          media_url?: string | null;
          occurred_at?: string;
          origin: Database["public"]["Enums"]["whatsapp_message_origin"];
          participant_phone?: string | null;
          provider: string;
          provider_message_id?: string | null;
          read_at?: string | null;
          reply_to_provider_message_id?: string | null;
          sender_name?: string | null;
          sent_by?: string | null;
          seq?: never;
          status?: Database["public"]["Enums"]["whatsapp_delivery_status"];
        };
        Update: {
          body?: string;
          chat_id?: string;
          created_at?: string;
          delivered_at?: string | null;
          direction?: Database["public"]["Enums"]["whatsapp_direction"];
          error_message?: string | null;
          id?: string;
          kind?: Database["public"]["Enums"]["whatsapp_message_kind"];
          media_duration_seconds?: number | null;
          media_file_name?: string | null;
          media_mime?: string | null;
          media_path?: string | null;
          media_size_bytes?: number | null;
          media_status?: Database["public"]["Enums"]["whatsapp_media_status"] | null;
          media_url?: string | null;
          occurred_at?: string;
          origin?: Database["public"]["Enums"]["whatsapp_message_origin"];
          participant_phone?: string | null;
          provider?: string;
          provider_message_id?: string | null;
          read_at?: string | null;
          reply_to_provider_message_id?: string | null;
          sender_name?: string | null;
          sent_by?: string | null;
          seq?: never;
          status?: Database["public"]["Enums"]["whatsapp_delivery_status"];
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_chat_id_fkey";
            columns: ["chat_id"];
            isOneToOne: false;
            referencedRelation: "whatsapp_chats";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "whatsapp_messages_sent_by_fkey";
            columns: ["sent_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      intelligence_daily_metrics: {
        Row: {
          confianca_media: number | null;
          confirmacoes: number | null;
          conversas: number | null;
          desconhecidos: number | null;
          dia: string | null;
          encaminhamentos: number | null;
          entregas: number | null;
          erros: number | null;
          latencia_media_ms: number | null;
          sem_conteudo: number | null;
          tokens_entrada: number | null;
          tokens_saida: number | null;
          turnos: number | null;
          turnos_com_modelo: number | null;
        };
        Relationships: [];
      };
      intelligence_intent_totals: {
        Row: {
          confianca_media: number | null;
          entregas: number | null;
          erros: number | null;
          intent: string | null;
          sem_conteudo: number | null;
          turnos: number | null;
        };
        Relationships: [];
      };
      intelligence_unknown_questions: {
        Row: {
          confidence: number | null;
          created_at: string | null;
          id: number | null;
          outcome: Database["public"]["Enums"]["intelligence_outcome"] | null;
          pergunta: string | null;
          whatsapp_chat_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "intelligence_interactions_whatsapp_chat_id_fkey";
            columns: ["whatsapp_chat_id"];
            isOneToOne: false;
            referencedRelation: "whatsapp_chats";
            referencedColumns: ["id"];
          },
        ];
      };
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
      activate_market_bulletin_version: {
        Args: { p_bulletin_id: string; p_version_id: string };
        Returns: {
          activated_at: string | null;
          activated_by: string | null;
          bulletin_id: string;
          deactivated_at: string | null;
          deactivated_by: string | null;
          effective_date: string;
          id: string;
          image_filename: string;
          image_mime_type: string;
          image_path: string;
          image_size_bytes: number;
          pdf_filename: string;
          pdf_mime_type: string;
          pdf_path: string;
          pdf_size_bytes: number;
          status: Database["public"]["Enums"]["market_bulletin_version_status"];
          status_reason: Database["public"]["Enums"]["market_bulletin_status_reason"] | null;
          uploaded_at: string;
          uploaded_by: string | null;
          version: number;
          version_name: string;
        };
        SetofOptions: {
          from: "*";
          to: "market_bulletin_versions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      activate_survey: {
        Args: { p_survey_id: string };
        Returns: {
          allows_response_change: boolean;
          created_at: string;
          created_by: string | null;
          description: string | null;
          ends_at: string | null;
          id: string;
          image_mime: string | null;
          image_path: string | null;
          image_size_bytes: number | null;
          is_anonymous: boolean;
          scheduled_at: string | null;
          search_text: string | null;
          single_response_only: boolean;
          starts_at: string | null;
          status: Database["public"]["Enums"]["survey_status"];
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "surveys";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      approve_membership_application: {
        Args: { p_application_id: string; p_note?: string };
        Returns: {
          activity_area: string | null;
          city: string | null;
          cnpj: string | null;
          code: string | null;
          contact_id: string | null;
          created_at: string;
          created_by: string | null;
          email: string | null;
          external_id: string | null;
          farm_name: string | null;
          full_name: string;
          id: string;
          interests: string[];
          job_title: string | null;
          joined_at: string | null;
          legal_name: string | null;
          notes: string | null;
          organization: string | null;
          origin: Database["public"]["Enums"]["member_origin"];
          other_interest: string | null;
          production_city: string | null;
          profile_type: Database["public"]["Enums"]["membership_profile_type"] | null;
          sow_count: number | null;
          state: string | null;
          state_registration: string | null;
          status: Database["public"]["Enums"]["member_status"];
          trade_name: string | null;
          updated_at: string;
          updated_by: string | null;
          whatsapp: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "members";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      assert_event_segments: {
        Args: { p_segment_ids: string[] };
        Returns: undefined;
      };
      assert_lecture_profile: {
        Args: { p_profile_id: string };
        Returns: undefined;
      };
      assert_survey_audience: {
        Args: { p_survey_id: string };
        Returns: undefined;
      };
      assert_survey_structure_editable: {
        Args: { p_survey_id: string };
        Returns: undefined;
      };
      assign_lecture_responsible: {
        Args: { p_lecture_id: string; p_profile_id: string };
        Returns: {
          attendees_actual: number | null;
          attendees_estimated: number | null;
          cancellation_reason: string | null;
          city: string;
          created_at: string;
          created_by: string | null;
          end_time: string | null;
          event_date: string;
          format: Database["public"]["Enums"]["lecture_format"] | null;
          held_at: string | null;
          id: string;
          idempotency_key: string | null;
          location: string | null;
          name: string;
          notes: string | null;
          origin: Database["public"]["Enums"]["lecture_origin"];
          outcome_notes: string | null;
          priority: Database["public"]["Enums"]["lecture_priority"];
          protocol: string;
          rejection_reason: string | null;
          requested_at: string;
          requester_contact_id: string | null;
          requester_email: string | null;
          requester_name: string | null;
          requester_organization: string | null;
          requester_phone: string | null;
          responsible_id: string | null;
          search_text: string | null;
          speaker_catalog_id: string | null;
          speaker_id: string | null;
          start_time: string | null;
          status: Database["public"]["Enums"]["lecture_status"];
          theme: string;
          type: Database["public"]["Enums"]["lecture_type"];
          type_other: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "lectures";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      assign_lecture_speaker: {
        Args: {
          p_lecture_id: string;
          p_profile_id: string;
          p_speaker_name?: string;
        };
        Returns: {
          attendees_actual: number | null;
          attendees_estimated: number | null;
          cancellation_reason: string | null;
          city: string;
          created_at: string;
          created_by: string | null;
          end_time: string | null;
          event_date: string;
          format: Database["public"]["Enums"]["lecture_format"] | null;
          held_at: string | null;
          id: string;
          idempotency_key: string | null;
          location: string | null;
          name: string;
          notes: string | null;
          origin: Database["public"]["Enums"]["lecture_origin"];
          outcome_notes: string | null;
          priority: Database["public"]["Enums"]["lecture_priority"];
          protocol: string;
          rejection_reason: string | null;
          requested_at: string;
          requester_contact_id: string | null;
          requester_email: string | null;
          requester_name: string | null;
          requester_organization: string | null;
          requester_phone: string | null;
          responsible_id: string | null;
          search_text: string | null;
          speaker_catalog_id: string | null;
          speaker_id: string | null;
          start_time: string | null;
          status: Database["public"]["Enums"]["lecture_status"];
          theme: string;
          type: Database["public"]["Enums"]["lecture_type"];
          type_other: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "lectures";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      block_opted_out_recipients: {
        Args: { p_survey_id: string };
        Returns: number;
      };
      broadcast_audience_size: {
        Args: { p_segment_ids: string[] };
        Returns: {
          blocked: number;
          reachable: number;
        }[];
      };
      broadcast_is_writer: { Args: never; Returns: boolean };
      cancel_survey: {
        Args: { p_reason?: string; p_survey_id: string };
        Returns: {
          allows_response_change: boolean;
          created_at: string;
          created_by: string | null;
          description: string | null;
          ends_at: string | null;
          id: string;
          image_mime: string | null;
          image_path: string | null;
          image_size_bytes: number | null;
          is_anonymous: boolean;
          scheduled_at: string | null;
          search_text: string | null;
          single_response_only: boolean;
          starts_at: string | null;
          status: Database["public"]["Enums"]["survey_status"];
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "surveys";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      claim_broadcast_recipients: {
        Args: { p_broadcast_id: string; p_limit?: number };
        Returns: {
          attempts: number;
          id: string;
          member_id: string;
          member_name: string;
          member_phone: string;
        }[];
      };
      claim_event_recipients: {
        Args: { p_dispatch_id: string; p_event_id: string; p_limit?: number };
        Returns: {
          attempts: number;
          created_at: string;
          event_id: string;
          id: string;
          last_attempt_at: string | null;
          last_dispatch_id: string | null;
          last_error: string | null;
          member_id: string | null;
          member_name: string | null;
          member_phone: string;
          provider_message_id: string | null;
          status: Database["public"]["Enums"]["event_recipient_status"];
        }[];
        SetofOptions: {
          from: "*";
          to: "event_recipients";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_survey_recipients: {
        Args: { p_dispatch_id: string; p_limit?: number; p_survey_id: string };
        Returns: {
          attempts: number;
          contact_id: string | null;
          contact_name: string | null;
          contact_phone: string | null;
          created_at: string;
          id: string;
          last_attempt_at: string | null;
          last_dispatch_id: string | null;
          last_error: string | null;
          provider_message_id: string | null;
          status: Database["public"]["Enums"]["survey_recipient_status"];
          survey_id: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "survey_recipients";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      close_survey: {
        Args: { p_survey_id: string };
        Returns: {
          allows_response_change: boolean;
          created_at: string;
          created_by: string | null;
          description: string | null;
          ends_at: string | null;
          id: string;
          image_mime: string | null;
          image_path: string | null;
          image_size_bytes: number | null;
          is_anonymous: boolean;
          scheduled_at: string | null;
          search_text: string | null;
          single_response_only: boolean;
          starts_at: string | null;
          status: Database["public"]["Enums"]["survey_status"];
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "surveys";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      close_survey_context: {
        Args: {
          p_reason?: string;
          p_state_id: string;
          p_status: Database["public"]["Enums"]["survey_context_status"];
        };
        Returns: {
          asked_at: string;
          channel: Database["public"]["Enums"]["survey_channel"];
          cleared_at: string | null;
          cleared_reason: string | null;
          contact_id: string;
          created_at: string;
          expires_at: string | null;
          id: string;
          invalid_attempts: number;
          provider_message_id: string | null;
          question_id: string;
          recipient_id: string | null;
          status: Database["public"]["Enums"]["survey_context_status"];
          survey_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "survey_conversation_states";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      complete_survey_inbound_event: {
        Args: {
          p_contact_id?: string;
          p_event_id: string;
          p_outcome: string;
          p_provider: string;
          p_survey_id?: string;
        };
        Returns: undefined;
      };
      count_active_user_managers: { Args: never; Returns: number };
      count_event_audience: {
        Args: { p_event_id: string };
        Returns: {
          blocked: number;
          total: number;
        }[];
      };
      count_survey_audience: { Args: { p_survey_id: string }; Returns: number };
      count_survey_context_miss: {
        Args: { p_max?: number; p_state_id: string };
        Returns: number;
      };
      create_app_role: {
        Args: {
          p_base_role: Database["public"]["Enums"]["app_role"];
          p_description: string;
          p_key: string;
          p_label: string;
          p_permissions: string[];
        };
        Returns: {
          base_role: Database["public"]["Enums"]["app_role"];
          created_at: string;
          created_by: string | null;
          description: string | null;
          is_builtin: boolean;
          key: string;
          label: string;
          sort_order: number;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "app_roles";
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
      create_event: {
        Args: {
          p_description: string;
          p_end_time: string;
          p_event_date: string;
          p_event_id: string;
          p_image_mime: string;
          p_image_path: string;
          p_image_size_bytes: number;
          p_location: string;
          p_name: string;
          p_registration_url: string;
          p_segment_ids: string[];
          p_start_time: string;
        };
        Returns: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          end_time: string | null;
          event_date: string;
          id: string;
          image_mime: string;
          image_path: string;
          image_size_bytes: number;
          location: string;
          name: string;
          registration_url: string | null;
          start_time: string;
          status: Database["public"]["Enums"]["event_status"];
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "events";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_lecture: {
        Args: {
          p_attendees_estimated: number;
          p_city: string;
          p_end_time: string;
          p_event_date: string;
          p_format: Database["public"]["Enums"]["lecture_format"];
          p_location: string;
          p_name: string;
          p_notes: string;
          p_priority: Database["public"]["Enums"]["lecture_priority"];
          p_requester_email?: string;
          p_requester_name?: string;
          p_requester_organization?: string;
          p_requester_phone?: string;
          p_responsible_id: string;
          p_speaker_id: string;
          p_speaker_name?: string;
          p_start_time: string;
          p_status: Database["public"]["Enums"]["lecture_status"];
          p_theme: string;
          p_type: Database["public"]["Enums"]["lecture_type"];
          p_type_other: string;
        };
        Returns: {
          attendees_actual: number | null;
          attendees_estimated: number | null;
          cancellation_reason: string | null;
          city: string;
          created_at: string;
          created_by: string | null;
          end_time: string | null;
          event_date: string;
          format: Database["public"]["Enums"]["lecture_format"] | null;
          held_at: string | null;
          id: string;
          idempotency_key: string | null;
          location: string | null;
          name: string;
          notes: string | null;
          origin: Database["public"]["Enums"]["lecture_origin"];
          outcome_notes: string | null;
          priority: Database["public"]["Enums"]["lecture_priority"];
          protocol: string;
          rejection_reason: string | null;
          requested_at: string;
          requester_contact_id: string | null;
          requester_email: string | null;
          requester_name: string | null;
          requester_organization: string | null;
          requester_phone: string | null;
          responsible_id: string | null;
          search_text: string | null;
          speaker_catalog_id: string | null;
          speaker_id: string | null;
          start_time: string | null;
          status: Database["public"]["Enums"]["lecture_status"];
          theme: string;
          type: Database["public"]["Enums"]["lecture_type"];
          type_other: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "lectures";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_lecture_request: {
        Args: {
          p_attendees_estimated: number;
          p_city: string;
          p_event_date: string;
          p_format: Database["public"]["Enums"]["lecture_format"];
          p_idempotency_key?: string;
          p_location: string;
          p_name?: string;
          p_notes: string;
          p_requester_contact_id: string;
          p_requester_email: string;
          p_requester_name: string;
          p_requester_organization: string;
          p_requester_phone: string;
          p_start_time: string;
          p_theme: string;
          p_type: Database["public"]["Enums"]["lecture_type"];
          p_type_other: string;
        };
        Returns: {
          attendees_actual: number | null;
          attendees_estimated: number | null;
          cancellation_reason: string | null;
          city: string;
          created_at: string;
          created_by: string | null;
          end_time: string | null;
          event_date: string;
          format: Database["public"]["Enums"]["lecture_format"] | null;
          held_at: string | null;
          id: string;
          idempotency_key: string | null;
          location: string | null;
          name: string;
          notes: string | null;
          origin: Database["public"]["Enums"]["lecture_origin"];
          outcome_notes: string | null;
          priority: Database["public"]["Enums"]["lecture_priority"];
          protocol: string;
          rejection_reason: string | null;
          requested_at: string;
          requester_contact_id: string | null;
          requester_email: string | null;
          requester_name: string | null;
          requester_organization: string | null;
          requester_phone: string | null;
          responsible_id: string | null;
          search_text: string | null;
          speaker_catalog_id: string | null;
          speaker_id: string | null;
          start_time: string | null;
          status: Database["public"]["Enums"]["lecture_status"];
          theme: string;
          type: Database["public"]["Enums"]["lecture_type"];
          type_other: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "lectures";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_market_bulletin: {
        Args: {
          p_chatbot_enabled: boolean;
          p_description: string;
          p_name: string;
        };
        Returns: {
          chatbot_enabled: boolean;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          name: string;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "market_bulletins";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_market_bulletin_version: {
        Args: {
          p_bulletin_id: string;
          p_effective_date: string;
          p_image_filename: string;
          p_image_mime_type: string;
          p_image_path: string;
          p_image_size_bytes: number;
          p_pdf_filename: string;
          p_pdf_path: string;
          p_pdf_size_bytes: number;
          p_version_id: string;
        };
        Returns: {
          activated_at: string | null;
          activated_by: string | null;
          bulletin_id: string;
          deactivated_at: string | null;
          deactivated_by: string | null;
          effective_date: string;
          id: string;
          image_filename: string;
          image_mime_type: string;
          image_path: string;
          image_size_bytes: number;
          pdf_filename: string;
          pdf_mime_type: string;
          pdf_path: string;
          pdf_size_bytes: number;
          status: Database["public"]["Enums"]["market_bulletin_version_status"];
          status_reason: Database["public"]["Enums"]["market_bulletin_status_reason"] | null;
          uploaded_at: string;
          uploaded_by: string | null;
          version: number;
          version_name: string;
        };
        SetofOptions: {
          from: "*";
          to: "market_bulletin_versions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_survey: {
        Args: {
          p_allows_response_change?: boolean;
          p_description: string;
          p_ends_at?: string;
          p_is_anonymous?: boolean;
          p_options: string[];
          p_question: string;
          p_scheduled_at?: string;
          p_starts_at?: string;
          p_title: string;
        };
        Returns: {
          allows_response_change: boolean;
          created_at: string;
          created_by: string | null;
          description: string | null;
          ends_at: string | null;
          id: string;
          image_mime: string | null;
          image_path: string | null;
          image_size_bytes: number | null;
          is_anonymous: boolean;
          scheduled_at: string | null;
          search_text: string | null;
          single_response_only: boolean;
          starts_at: string | null;
          status: Database["public"]["Enums"]["survey_status"];
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "surveys";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      current_actor_name: { Args: never; Returns: string };
      current_app_role: {
        Args: never;
        Returns: Database["public"]["Enums"]["app_role"];
      };
      current_consent_text: {
        Args: never;
        Returns: {
          body: string;
          created_at: string;
          created_by: string | null;
          version: string;
        };
        SetofOptions: {
          from: "*";
          to: "consent_texts";
          isOneToOne: true;
          isSetofReturn: false;
        };
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
      deactivate_market_bulletin_version: {
        Args: { p_bulletin_id: string; p_version_id: string };
        Returns: {
          activated_at: string | null;
          activated_by: string | null;
          bulletin_id: string;
          deactivated_at: string | null;
          deactivated_by: string | null;
          effective_date: string;
          id: string;
          image_filename: string;
          image_mime_type: string;
          image_path: string;
          image_size_bytes: number;
          pdf_filename: string;
          pdf_mime_type: string;
          pdf_path: string;
          pdf_size_bytes: number;
          status: Database["public"]["Enums"]["market_bulletin_version_status"];
          status_reason: Database["public"]["Enums"]["market_bulletin_status_reason"] | null;
          uploaded_at: string;
          uploaded_by: string | null;
          version: number;
          version_name: string;
        };
        SetofOptions: {
          from: "*";
          to: "market_bulletin_versions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      delete_app_role: { Args: { p_key: string }; Returns: undefined };
      delete_survey: { Args: { p_survey_id: string }; Returns: undefined };
      estimate_audience_criteria: {
        Args: { p_criteria: Json };
        Returns: number;
      };
      event_segments_for_member: {
        Args: { p_member_id: string };
        Returns: string[];
      };
      event_today: { Args: never; Returns: string };
      expand_event_segments: {
        Args: { p_segment_ids: string[] };
        Returns: string[];
      };
      expire_survey_contexts: { Args: never; Returns: number };
      find_contact_by_whatsapp: {
        Args: { p_number: string };
        Returns: {
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
        }[];
        SetofOptions: {
          from: "*";
          to: "chat_contacts";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      find_lecture_conflicts: {
        Args: {
          p_end_time: string;
          p_event_date: string;
          p_exclude_id?: string;
          p_start_time: string;
        };
        Returns: {
          attendees_actual: number | null;
          attendees_estimated: number | null;
          cancellation_reason: string | null;
          city: string;
          created_at: string;
          created_by: string | null;
          end_time: string | null;
          event_date: string;
          format: Database["public"]["Enums"]["lecture_format"] | null;
          held_at: string | null;
          id: string;
          idempotency_key: string | null;
          location: string | null;
          name: string;
          notes: string | null;
          origin: Database["public"]["Enums"]["lecture_origin"];
          outcome_notes: string | null;
          priority: Database["public"]["Enums"]["lecture_priority"];
          protocol: string;
          rejection_reason: string | null;
          requested_at: string;
          requester_contact_id: string | null;
          requester_email: string | null;
          requester_name: string | null;
          requester_organization: string | null;
          requester_phone: string | null;
          responsible_id: string | null;
          search_text: string | null;
          speaker_catalog_id: string | null;
          speaker_id: string | null;
          start_time: string | null;
          status: Database["public"]["Enums"]["lecture_status"];
          theme: string;
          type: Database["public"]["Enums"]["lecture_type"];
          type_other: string | null;
          updated_at: string;
          updated_by: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "lectures";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      finish_broadcast: {
        Args: { p_broadcast_id: string; p_last_error?: string };
        Returns: {
          body: string;
          created_by: string | null;
          created_by_name: string | null;
          finished_at: string | null;
          id: string;
          image_bucket: string | null;
          image_filename: string | null;
          image_mime: string | null;
          image_path: string | null;
          last_error: string | null;
          media_bucket: string | null;
          media_filename: string | null;
          media_mime: string | null;
          media_path: string | null;
          source: Database["public"]["Enums"]["broadcast_source"];
          source_id: string;
          started_at: string;
          status: Database["public"]["Enums"]["broadcast_status"];
          title: string;
          total_blocked: number;
          total_errors: number;
          total_recipients: number;
          total_sent: number;
        };
        SetofOptions: {
          from: "*";
          to: "broadcasts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      finish_event_dispatch: {
        Args: {
          p_dispatch_id: string;
          p_last_error?: string;
          p_status: Database["public"]["Enums"]["event_dispatch_status"];
        };
        Returns: undefined;
      };
      finish_survey_dispatch: {
        Args: { p_dispatch_id: string };
        Returns: {
          created_by: string | null;
          finished_at: string | null;
          id: string;
          last_error: string | null;
          started_at: string;
          status: Database["public"]["Enums"]["survey_dispatch_status"];
          survey_id: string;
          total_errors: number;
          total_recipients: number;
          total_sent: number;
        };
        SetofOptions: {
          from: "*";
          to: "survey_dispatches";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      get_survey_for_chatbot: {
        Args: { p_survey_id: string };
        Returns: {
          option_id: string;
          option_position: number;
          option_text: string;
          question: string;
          question_id: string;
          survey_id: string;
          title: string;
        }[];
      };
      is_admin: { Args: never; Returns: boolean };
      is_notification_blocked: { Args: { p_phone: string }; Returns: boolean };
      lecture_speaker_label: {
        Args: { p_catalog_id: string; p_profile_id: string };
        Returns: string;
      };
      link_phone_book_entry: {
        Args: {
          p_city: string;
          p_current: string;
          p_full_name: string;
          p_phone: string;
          p_state: string;
        };
        Returns: string;
      };
      list_notification_blocks: {
        Args: {
          p_include_revoked?: boolean;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: {
          channel: Database["public"]["Enums"]["survey_channel"];
          contact_name: string;
          created_at: string;
          id: string;
          member_id: string;
          member_name: string;
          note: string;
          phone_key: string;
          revoked_at: string;
          revoked_note: string;
          source: string;
          total_count: number;
        }[];
      };
      lock_document: { Args: { p_document_id: string }; Returns: undefined };
      lock_event: { Args: { p_event_id: string }; Returns: undefined };
      lock_lecture: { Args: { p_lecture_id: string }; Returns: undefined };
      lock_market_bulletin: {
        Args: { p_bulletin_id: string };
        Returns: undefined;
      };
      lock_membership_application: {
        Args: { p_application_id: string };
        Returns: undefined;
      };
      lock_survey: { Args: { p_survey_id: string }; Returns: undefined };
      log_admin_action: {
        Args: {
          p_action: Database["public"]["Enums"]["admin_audit_action"];
          p_metadata?: Json;
          p_target: string;
        };
        Returns: undefined;
      };
      log_password_reset: { Args: { p_email: string }; Returns: undefined };
      log_user_invite: {
        Args: {
          p_email: string;
          p_role: Database["public"]["Enums"]["app_role"];
        };
        Returns: undefined;
      };
      log_user_invite_cargo: {
        Args: { p_email: string; p_role_key: string };
        Returns: undefined;
      };
      mark_survey_recipient: {
        Args: {
          p_error?: string;
          p_provider_message_id?: string;
          p_recipient_id: string;
          p_status: Database["public"]["Enums"]["survey_recipient_status"];
        };
        Returns: {
          attempts: number;
          contact_id: string | null;
          contact_name: string | null;
          contact_phone: string | null;
          created_at: string;
          id: string;
          last_attempt_at: string | null;
          last_dispatch_id: string | null;
          last_error: string | null;
          provider_message_id: string | null;
          status: Database["public"]["Enums"]["survey_recipient_status"];
          survey_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "survey_recipients";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      mark_survey_recipient_by_message: {
        Args: {
          p_error?: string;
          p_provider_message_id: string;
          p_status: Database["public"]["Enums"]["survey_recipient_status"];
        };
        Returns: {
          attempts: number;
          contact_id: string | null;
          contact_name: string | null;
          contact_phone: string | null;
          created_at: string;
          id: string;
          last_attempt_at: string | null;
          last_dispatch_id: string | null;
          last_error: string | null;
          provider_message_id: string | null;
          status: Database["public"]["Enums"]["survey_recipient_status"];
          survey_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "survey_recipients";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      market_bulletin_version_name: {
        Args: { p_date: string };
        Returns: string;
      };
      member_notification_status: {
        Args: { p_member_id: string };
        Returns: {
          opted_out: boolean;
          opted_out_at: string;
          source: string;
        }[];
      };
      members_in_event_segments: {
        Args: { p_slugs: string[] };
        Returns: string[];
      };
      membership_ip_hourly_limit: { Args: never; Returns: number };
      membership_is_reader: { Args: never; Returns: boolean };
      membership_is_writer: { Args: never; Returns: boolean };
      next_lecture_protocol: { Args: never; Returns: string };
      next_membership_protocol: { Args: never; Returns: string };
      notification_phone_key: { Args: { p_phone: string }; Returns: string };
      open_survey_context: {
        Args: {
          p_channel: Database["public"]["Enums"]["survey_channel"];
          p_provider_message_id?: string;
          p_recipient_id: string;
        };
        Returns: {
          asked_at: string;
          channel: Database["public"]["Enums"]["survey_channel"];
          cleared_at: string | null;
          cleared_reason: string | null;
          contact_id: string;
          created_at: string;
          expires_at: string | null;
          id: string;
          invalid_attempts: number;
          provider_message_id: string | null;
          question_id: string;
          recipient_id: string | null;
          status: Database["public"]["Enums"]["survey_context_status"];
          survey_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "survey_conversation_states";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      process_scheduled_surveys: {
        Args: never;
        Returns: {
          activated: number;
          closed: number;
        }[];
      };
      profile_for_event_segment: {
        Args: { p_slug: string };
        Returns: Database["public"]["Enums"]["membership_profile_type"];
      };
      publish_consent_text: {
        Args: { p_body: string; p_version: string };
        Returns: {
          body: string;
          created_at: string;
          created_by: string | null;
          version: string;
        };
        SetofOptions: {
          from: "*";
          to: "consent_texts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      reconcile_survey_counters: {
        Args: { p_survey_id?: string };
        Returns: {
          dispatches_recomputed: number;
          recipients_marked_responded: number;
          recipients_stuck_sending: number;
          responses_without_recipient: number;
          survey_id: string;
        }[];
      };
      record_survey_inbound_event: {
        Args: {
          p_contact_id?: string;
          p_correlation_id?: string;
          p_event_id: string;
          p_event_type: string;
          p_provider: string;
          p_survey_id?: string;
        };
        Returns: boolean;
      };
      register_lecture_outcome: {
        Args: {
          p_attendees_actual: number;
          p_held_at: string;
          p_lecture_id: string;
          p_outcome_notes: string;
        };
        Returns: {
          attendees_actual: number | null;
          attendees_estimated: number | null;
          cancellation_reason: string | null;
          city: string;
          created_at: string;
          created_by: string | null;
          end_time: string | null;
          event_date: string;
          format: Database["public"]["Enums"]["lecture_format"] | null;
          held_at: string | null;
          id: string;
          idempotency_key: string | null;
          location: string | null;
          name: string;
          notes: string | null;
          origin: Database["public"]["Enums"]["lecture_origin"];
          outcome_notes: string | null;
          priority: Database["public"]["Enums"]["lecture_priority"];
          protocol: string;
          rejection_reason: string | null;
          requested_at: string;
          requester_contact_id: string | null;
          requester_email: string | null;
          requester_name: string | null;
          requester_organization: string | null;
          requester_phone: string | null;
          responsible_id: string | null;
          search_text: string | null;
          speaker_catalog_id: string | null;
          speaker_id: string | null;
          start_time: string | null;
          status: Database["public"]["Enums"]["lecture_status"];
          theme: string;
          type: Database["public"]["Enums"]["lecture_type"];
          type_other: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "lectures";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      register_notification_opt_out: {
        Args: {
          p_channel?: Database["public"]["Enums"]["survey_channel"];
          p_contact_id?: string;
          p_note?: string;
          p_phone: string;
          p_source?: string;
        };
        Returns: string;
      };
      register_survey_opt_out: {
        Args: {
          p_channel: Database["public"]["Enums"]["survey_channel"];
          p_contact_id: string;
          p_note?: string;
          p_source?: string;
        };
        Returns: boolean;
      };
      register_survey_response: {
        Args: {
          p_contact_id: string;
          p_option_id: string;
          p_source_message_id?: string;
          p_survey_id: string;
        };
        Returns: Database["public"]["Enums"]["survey_response_outcome"];
      };
      reject_membership_application: {
        Args: { p_application_id: string; p_reason: string };
        Returns: {
          activity_area: string | null;
          city: string;
          cnpj: string | null;
          consent_accepted: boolean;
          consent_at: string;
          consent_policy_version: string | null;
          created_at: string;
          dedupe_key: string;
          email: string;
          farm_name: string | null;
          full_name: string;
          id: string;
          interests: string[];
          job_title: string | null;
          legal_name: string | null;
          member_id: string | null;
          organization: string | null;
          other_interest: string | null;
          production_city: string | null;
          profile_type: Database["public"]["Enums"]["membership_profile_type"];
          protocol: string;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source_ip_hash: string | null;
          sow_count: number | null;
          state: string;
          state_registration: string | null;
          status: Database["public"]["Enums"]["membership_application_status"];
          trade_name: string | null;
          updated_at: string;
          user_agent: string | null;
          whatsapp: string;
        };
        SetofOptions: {
          from: "*";
          to: "membership_applications";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      release_stale_broadcast_recipients: {
        Args: { p_broadcast_id: string; p_older_than?: string };
        Returns: number;
      };
      release_stale_event_recipients: {
        Args: { p_event_id: string; p_older_than?: string };
        Returns: number;
      };
      release_survey_recipients: { Args: { p_ids: string[] }; Returns: number };
      reopen_membership_application: {
        Args: { p_application_id: string; p_reason?: string };
        Returns: {
          activity_area: string | null;
          city: string;
          cnpj: string | null;
          consent_accepted: boolean;
          consent_at: string;
          consent_policy_version: string | null;
          created_at: string;
          dedupe_key: string;
          email: string;
          farm_name: string | null;
          full_name: string;
          id: string;
          interests: string[];
          job_title: string | null;
          legal_name: string | null;
          member_id: string | null;
          organization: string | null;
          other_interest: string | null;
          production_city: string | null;
          profile_type: Database["public"]["Enums"]["membership_profile_type"];
          protocol: string;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source_ip_hash: string | null;
          sow_count: number | null;
          state: string;
          state_registration: string | null;
          status: Database["public"]["Enums"]["membership_application_status"];
          trade_name: string | null;
          updated_at: string;
          user_agent: string | null;
          whatsapp: string;
        };
        SetofOptions: {
          from: "*";
          to: "membership_applications";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      requeue_stuck_survey_recipients: {
        Args: { p_older_than?: string };
        Returns: number;
      };
      reschedule_lecture: {
        Args: {
          p_end_time: string;
          p_event_date: string;
          p_lecture_id: string;
          p_start_time: string;
        };
        Returns: {
          attendees_actual: number | null;
          attendees_estimated: number | null;
          cancellation_reason: string | null;
          city: string;
          created_at: string;
          created_by: string | null;
          end_time: string | null;
          event_date: string;
          format: Database["public"]["Enums"]["lecture_format"] | null;
          held_at: string | null;
          id: string;
          idempotency_key: string | null;
          location: string | null;
          name: string;
          notes: string | null;
          origin: Database["public"]["Enums"]["lecture_origin"];
          outcome_notes: string | null;
          priority: Database["public"]["Enums"]["lecture_priority"];
          protocol: string;
          rejection_reason: string | null;
          requested_at: string;
          requester_contact_id: string | null;
          requester_email: string | null;
          requester_name: string | null;
          requester_organization: string | null;
          requester_phone: string | null;
          responsible_id: string | null;
          search_text: string | null;
          speaker_catalog_id: string | null;
          speaker_id: string | null;
          start_time: string | null;
          status: Database["public"]["Enums"]["lecture_status"];
          theme: string;
          type: Database["public"]["Enums"]["lecture_type"];
          type_other: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "lectures";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      resolve_audience_criteria: {
        Args: { p_criteria: Json };
        Returns: {
          contact_id: string;
          full_name: string;
          phone: string;
        }[];
      };
      resolve_lecture_city: { Args: { p_city: string }; Returns: string };
      resolve_lecture_speaker: { Args: { p_name: string }; Returns: string };
      resolve_survey_audience: {
        Args: { p_survey_id: string };
        Returns: {
          contact_id: string;
          full_name: string;
          phone: string;
        }[];
      };
      resolve_survey_context: {
        Args: {
          p_channel: Database["public"]["Enums"]["survey_channel"];
          p_contact_id: string;
          p_reply_to_message_id?: string;
        };
        Returns: {
          asked_at: string;
          matched_by: string;
          question_id: string;
          recipient_id: string;
          state_id: string;
          survey_id: string;
          survey_title: string;
        }[];
      };
      resume_member_notifications: {
        Args: { p_member_id: string; p_note: string };
        Returns: number;
      };
      resume_notification_block: {
        Args: { p_note: string; p_opt_out_id: string };
        Returns: boolean;
      };
      retry_failed_broadcast_recipients: {
        Args: { p_broadcast_id: string; p_max_attempts?: number };
        Returns: number;
      };
      retry_failed_survey_recipients: {
        Args: { p_max_attempts?: number; p_survey_id: string };
        Returns: number;
      };
      schedule_survey: {
        Args: {
          p_ends_at?: string;
          p_scheduled_at: string;
          p_starts_at?: string;
          p_survey_id: string;
        };
        Returns: {
          allows_response_change: boolean;
          created_at: string;
          created_by: string | null;
          description: string | null;
          ends_at: string | null;
          id: string;
          image_mime: string | null;
          image_path: string | null;
          image_size_bytes: number | null;
          is_anonymous: boolean;
          scheduled_at: string | null;
          search_text: string | null;
          single_response_only: boolean;
          starts_at: string | null;
          status: Database["public"]["Enums"]["survey_status"];
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "surveys";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      search_knowledge: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          category: string;
          content: string;
          id: string;
          score: number;
          title: string;
        }[];
      };
      set_app_setting: {
        Args: { p_key: string; p_value: string };
        Returns: {
          key: string;
          updated_at: string;
          updated_by: string | null;
          value: string;
        };
        SetofOptions: {
          from: "*";
          to: "app_settings";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_event_status: {
        Args: { p_command: string; p_event_id: string };
        Returns: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          end_time: string | null;
          event_date: string;
          id: string;
          image_mime: string;
          image_path: string;
          image_size_bytes: number;
          location: string;
          name: string;
          registration_url: string | null;
          start_time: string;
          status: Database["public"]["Enums"]["event_status"];
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "events";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_lecture_status: {
        Args: {
          p_lecture_id: string;
          p_reason?: string;
          p_status: Database["public"]["Enums"]["lecture_status"];
        };
        Returns: {
          attendees_actual: number | null;
          attendees_estimated: number | null;
          cancellation_reason: string | null;
          city: string;
          created_at: string;
          created_by: string | null;
          end_time: string | null;
          event_date: string;
          format: Database["public"]["Enums"]["lecture_format"] | null;
          held_at: string | null;
          id: string;
          idempotency_key: string | null;
          location: string | null;
          name: string;
          notes: string | null;
          origin: Database["public"]["Enums"]["lecture_origin"];
          outcome_notes: string | null;
          priority: Database["public"]["Enums"]["lecture_priority"];
          protocol: string;
          rejection_reason: string | null;
          requested_at: string;
          requester_contact_id: string | null;
          requester_email: string | null;
          requester_name: string | null;
          requester_organization: string | null;
          requester_phone: string | null;
          responsible_id: string | null;
          search_text: string | null;
          speaker_catalog_id: string | null;
          speaker_id: string | null;
          start_time: string | null;
          status: Database["public"]["Enums"]["lecture_status"];
          theme: string;
          type: Database["public"]["Enums"]["lecture_type"];
          type_other: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "lectures";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_survey_audience: {
        Args: { p_criteria: Json; p_survey_id: string };
        Returns: number;
      };
      set_user_active: {
        Args: { p_active: boolean; p_user_id: string };
        Returns: {
          active: boolean;
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          role_key: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "profiles";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_user_role: {
        Args: {
          p_role: Database["public"]["Enums"]["app_role"];
          p_user_id: string;
        };
        Returns: {
          active: boolean;
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          role_key: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "profiles";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_user_role_key: {
        Args: { p_role_key: string; p_user_id: string };
        Returns: {
          active: boolean;
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          role_key: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "profiles";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      settle_broadcast_recipient: {
        Args: {
          p_error?: string;
          p_ok: boolean;
          p_provider_message_id?: string;
          p_recipient_id: string;
        };
        Returns: undefined;
      };
      settle_event_recipient: {
        Args: {
          p_error: string;
          p_provider_message_id: string;
          p_recipient_id: string;
        };
        Returns: undefined;
      };
      speaker_name_key: { Args: { p_name: string }; Returns: string };
      start_broadcast: {
        Args: {
          p_body: string;
          p_image_bucket?: string;
          p_image_filename?: string;
          p_image_mime?: string;
          p_image_path?: string;
          p_media_bucket?: string;
          p_media_filename?: string;
          p_media_mime?: string;
          p_media_path?: string;
          p_segment_ids: string[];
          p_source: Database["public"]["Enums"]["broadcast_source"];
          p_source_id: string;
          p_title: string;
        };
        Returns: {
          blocked: number;
          broadcast_id: string;
          queued: number;
        }[];
      };
      start_event_dispatch: {
        Args: { p_event_id: string };
        Returns: {
          already: number;
          blocked: number;
          dispatch_id: string;
          queued: number;
        }[];
      };
      start_membership_review: {
        Args: { p_application_id: string };
        Returns: {
          activity_area: string | null;
          city: string;
          cnpj: string | null;
          consent_accepted: boolean;
          consent_at: string;
          consent_policy_version: string | null;
          created_at: string;
          dedupe_key: string;
          email: string;
          farm_name: string | null;
          full_name: string;
          id: string;
          interests: string[];
          job_title: string | null;
          legal_name: string | null;
          member_id: string | null;
          organization: string | null;
          other_interest: string | null;
          production_city: string | null;
          profile_type: Database["public"]["Enums"]["membership_profile_type"];
          protocol: string;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source_ip_hash: string | null;
          sow_count: number | null;
          state: string;
          state_registration: string | null;
          status: Database["public"]["Enums"]["membership_application_status"];
          trade_name: string | null;
          updated_at: string;
          user_agent: string | null;
          whatsapp: string;
        };
        SetofOptions: {
          from: "*";
          to: "membership_applications";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      start_survey_dispatch: {
        Args: { p_survey_id: string };
        Returns: {
          created_by: string | null;
          finished_at: string | null;
          id: string;
          last_error: string | null;
          started_at: string;
          status: Database["public"]["Enums"]["survey_dispatch_status"];
          survey_id: string;
          total_errors: number;
          total_recipients: number;
          total_sent: number;
        };
        SetofOptions: {
          from: "*";
          to: "survey_dispatches";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      submit_membership_application: {
        Args: {
          p_activity_area?: string;
          p_city: string;
          p_cnpj?: string;
          p_consent_policy_version?: string;
          p_dedupe_key: string;
          p_email: string;
          p_farm_name?: string;
          p_full_name: string;
          p_interests?: string[];
          p_job_title?: string;
          p_legal_name?: string;
          p_organization?: string;
          p_other_interest?: string;
          p_production_city?: string;
          p_profile_type: Database["public"]["Enums"]["membership_profile_type"];
          p_source_ip_hash?: string;
          p_sow_count?: number;
          p_state: string;
          p_state_registration?: string;
          p_trade_name?: string;
          p_user_agent?: string;
          p_whatsapp: string;
        };
        Returns: {
          application_id: string;
          duplicate: boolean;
          protocol: string;
        }[];
      };
      survey_is_reader: { Args: never; Returns: boolean };
      survey_is_writer: { Args: never; Returns: boolean };
      survey_metrics: {
        Args: { p_survey_id: string };
        Returns: {
          participation_rate: number;
          total_audience: number;
          total_delivered: number;
          total_errors: number;
          total_read: number;
          total_responses: number;
          total_sent: number;
        }[];
      };
      survey_metrics_batch: {
        Args: { p_survey_ids: string[] };
        Returns: {
          participation_rate: number;
          survey_id: string;
          total_audience: number;
          total_delivered: number;
          total_errors: number;
          total_read: number;
          total_responses: number;
          total_sent: number;
        }[];
      };
      survey_observability_counters: {
        Args: { p_since?: string };
        Returns: {
          metric: string;
          value: number;
        }[];
      };
      survey_participants: {
        Args: { p_survey_id: string };
        Returns: {
          answered_at: string;
          contact_id: string;
          contact_name: string;
          option_id: string;
          option_text: string;
        }[];
      };
      survey_participants_page: {
        Args: {
          p_limit?: number;
          p_offset?: number;
          p_query?: string;
          p_survey_id: string;
        };
        Returns: {
          answered_at: string;
          contact_id: string;
          contact_name: string;
          option_id: string;
          option_text: string;
          total_count: number;
        }[];
      };
      survey_response_gate: {
        Args: { p_survey_id: string };
        Returns: Database["public"]["Enums"]["survey_response_outcome"];
      };
      survey_results: {
        Args: { p_survey_id: string };
        Returns: {
          option_active: boolean;
          option_id: string;
          option_position: number;
          option_text: string;
          percentage: number;
          total: number;
        }[];
      };
      unschedule_survey: {
        Args: { p_survey_id: string };
        Returns: {
          allows_response_change: boolean;
          created_at: string;
          created_by: string | null;
          description: string | null;
          ends_at: string | null;
          id: string;
          image_mime: string | null;
          image_path: string | null;
          image_size_bytes: number | null;
          is_anonymous: boolean;
          scheduled_at: string | null;
          search_text: string | null;
          single_response_only: boolean;
          starts_at: string | null;
          status: Database["public"]["Enums"]["survey_status"];
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "surveys";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_app_role: {
        Args: {
          p_description: string;
          p_key: string;
          p_label: string;
          p_permissions: string[];
        };
        Returns: {
          base_role: Database["public"]["Enums"]["app_role"];
          created_at: string;
          created_by: string | null;
          description: string | null;
          is_builtin: boolean;
          key: string;
          label: string;
          sort_order: number;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "app_roles";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_event: {
        Args: {
          p_description: string;
          p_end_time: string;
          p_event_date: string;
          p_event_id: string;
          p_image_mime: string;
          p_image_path: string;
          p_image_size_bytes: number;
          p_location: string;
          p_name: string;
          p_registration_url: string;
          p_segment_ids: string[];
          p_start_time: string;
        };
        Returns: {
          created_at: string;
          created_by: string | null;
          description: string | null;
          end_time: string | null;
          event_date: string;
          id: string;
          image_mime: string;
          image_path: string;
          image_size_bytes: number;
          location: string;
          name: string;
          registration_url: string | null;
          start_time: string;
          status: Database["public"]["Enums"]["event_status"];
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "events";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_event_segment: {
        Args: {
          p_active: boolean;
          p_description: string;
          p_name: string;
          p_segment_id: string;
        };
        Returns: {
          active: boolean;
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          slug: string;
        };
        SetofOptions: {
          from: "*";
          to: "event_segments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_lecture: {
        Args: {
          p_attendees_estimated: number;
          p_city: string;
          p_format: Database["public"]["Enums"]["lecture_format"];
          p_lecture_id: string;
          p_location: string;
          p_name: string;
          p_notes: string;
          p_priority: Database["public"]["Enums"]["lecture_priority"];
          p_theme: string;
          p_type: Database["public"]["Enums"]["lecture_type"];
          p_type_other: string;
        };
        Returns: {
          attendees_actual: number | null;
          attendees_estimated: number | null;
          cancellation_reason: string | null;
          city: string;
          created_at: string;
          created_by: string | null;
          end_time: string | null;
          event_date: string;
          format: Database["public"]["Enums"]["lecture_format"] | null;
          held_at: string | null;
          id: string;
          idempotency_key: string | null;
          location: string | null;
          name: string;
          notes: string | null;
          origin: Database["public"]["Enums"]["lecture_origin"];
          outcome_notes: string | null;
          priority: Database["public"]["Enums"]["lecture_priority"];
          protocol: string;
          rejection_reason: string | null;
          requested_at: string;
          requester_contact_id: string | null;
          requester_email: string | null;
          requester_name: string | null;
          requester_organization: string | null;
          requester_phone: string | null;
          responsible_id: string | null;
          search_text: string | null;
          speaker_catalog_id: string | null;
          speaker_id: string | null;
          start_time: string | null;
          status: Database["public"]["Enums"]["lecture_status"];
          theme: string;
          type: Database["public"]["Enums"]["lecture_type"];
          type_other: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "lectures";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_market_bulletin: {
        Args: {
          p_bulletin_id: string;
          p_chatbot_enabled: boolean;
          p_description: string;
          p_name: string;
        };
        Returns: {
          chatbot_enabled: boolean;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          name: string;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "market_bulletins";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_member: {
        Args: {
          p_activity_area?: string;
          p_city?: string;
          p_cnpj?: string;
          p_code?: string;
          p_email?: string;
          p_farm_name?: string;
          p_full_name: string;
          p_interests?: string[];
          p_job_title?: string;
          p_joined_at?: string;
          p_legal_name?: string;
          p_member_id: string;
          p_notes?: string;
          p_organization?: string;
          p_other_interest?: string;
          p_production_city?: string;
          p_profile_type?: Database["public"]["Enums"]["membership_profile_type"];
          p_sow_count?: number;
          p_state?: string;
          p_state_registration?: string;
          p_status: Database["public"]["Enums"]["member_status"];
          p_trade_name?: string;
          p_whatsapp?: string;
        };
        Returns: {
          activity_area: string | null;
          city: string | null;
          cnpj: string | null;
          code: string | null;
          contact_id: string | null;
          created_at: string;
          created_by: string | null;
          email: string | null;
          external_id: string | null;
          farm_name: string | null;
          full_name: string;
          id: string;
          interests: string[];
          job_title: string | null;
          joined_at: string | null;
          legal_name: string | null;
          notes: string | null;
          organization: string | null;
          origin: Database["public"]["Enums"]["member_origin"];
          other_interest: string | null;
          production_city: string | null;
          profile_type: Database["public"]["Enums"]["membership_profile_type"] | null;
          sow_count: number | null;
          state: string | null;
          state_registration: string | null;
          status: Database["public"]["Enums"]["member_status"];
          trade_name: string | null;
          updated_at: string;
          updated_by: string | null;
          whatsapp: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "members";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_survey: {
        Args: {
          p_allows_response_change: boolean;
          p_description: string;
          p_ends_at: string;
          p_is_anonymous: boolean;
          p_scheduled_at: string;
          p_starts_at: string;
          p_survey_id: string;
          p_title: string;
        };
        Returns: {
          allows_response_change: boolean;
          created_at: string;
          created_by: string | null;
          description: string | null;
          ends_at: string | null;
          id: string;
          image_mime: string | null;
          image_path: string | null;
          image_size_bytes: number | null;
          is_anonymous: boolean;
          scheduled_at: string | null;
          search_text: string | null;
          single_response_only: boolean;
          starts_at: string | null;
          status: Database["public"]["Enums"]["survey_status"];
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "surveys";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_survey_question: {
        Args: { p_options: string[]; p_question: string; p_survey_id: string };
        Returns: {
          allows_response_change: boolean;
          created_at: string;
          created_by: string | null;
          description: string | null;
          ends_at: string | null;
          id: string;
          image_mime: string | null;
          image_path: string | null;
          image_size_bytes: number | null;
          is_anonymous: boolean;
          scheduled_at: string | null;
          search_text: string | null;
          single_response_only: boolean;
          starts_at: string | null;
          status: Database["public"]["Enums"]["survey_status"];
          title: string;
          updated_at: string;
          updated_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "surveys";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      update_user_profile: {
        Args: { p_email: string; p_full_name: string; p_user_id: string };
        Returns: {
          active: boolean;
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          role_key: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "profiles";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      whatsapp_bot_pause_minutes: { Args: never; Returns: number };
      whatsapp_bot_rate_ok: { Args: { p_chat_id: string }; Returns: boolean };
      whatsapp_bot_should_answer: {
        Args: { p_chat_id: string };
        Returns: boolean;
      };
      whatsapp_is_reader: { Args: never; Returns: boolean };
      whatsapp_is_writer: { Args: never; Returns: boolean };
      whatsapp_kind_label: {
        Args: { p_kind: Database["public"]["Enums"]["whatsapp_message_kind"] };
        Returns: string;
      };
      whatsapp_mark_chat_read: {
        Args: { p_chat_id: string };
        Returns: undefined;
      };
      whatsapp_mark_message_status: {
        Args: {
          p_error?: string;
          p_occurred_at?: string;
          p_provider: string;
          p_provider_message_id: string;
          p_status: Database["public"]["Enums"]["whatsapp_delivery_status"];
        };
        Returns: boolean;
      };
      whatsapp_pause_bot: {
        Args: { p_chat_id: string; p_minutes?: number };
        Returns: undefined;
      };
      whatsapp_record_inbound_message: {
        Args: {
          p_body: string;
          p_chat_key: string;
          p_chat_name?: string;
          p_contact_id?: string;
          p_from_me: boolean;
          p_is_group?: boolean;
          p_kind?: Database["public"]["Enums"]["whatsapp_message_kind"];
          p_media_duration_seconds?: number;
          p_media_file_name?: string;
          p_media_mime?: string;
          p_media_status?: Database["public"]["Enums"]["whatsapp_media_status"];
          p_media_url?: string;
          p_occurred_at?: string;
          p_participant_phone?: string;
          p_phone?: string;
          p_photo_url?: string;
          p_provider: string;
          p_provider_message_id: string;
          p_reply_to?: string;
          p_sender_name?: string;
        };
        Returns: {
          chat_id: string;
          duplicate: boolean;
          message_id: string;
        }[];
      };
      whatsapp_set_chat_archived: {
        Args: { p_archived: boolean; p_chat_id: string };
        Returns: undefined;
      };
      whatsapp_set_media: {
        Args: {
          p_message_id: string;
          p_mime?: string;
          p_path?: string;
          p_size_bytes?: number;
          p_status: Database["public"]["Enums"]["whatsapp_media_status"];
        };
        Returns: undefined;
      };
      whatsapp_settle_outbound_message: {
        Args: {
          p_error?: string;
          p_message_id: string;
          p_provider_message_id?: string;
        };
        Returns: undefined;
      };
      whatsapp_start_bot_message: {
        Args: {
          p_body: string;
          p_chat_id: string;
          p_kind?: Database["public"]["Enums"]["whatsapp_message_kind"];
        };
        Returns: string;
      };
      whatsapp_start_outbound_message: {
        Args: { p_body: string; p_chat_id: string };
        Returns: string;
      };
      whatsapp_status_rank: {
        Args: {
          p_status: Database["public"]["Enums"]["whatsapp_delivery_status"];
        };
        Returns: number;
      };
      whatsapp_unread_total: { Args: never; Returns: number };
    };
    Enums: {
      admin_audit_action:
        | "user_role_changed"
        | "user_invited"
        | "segment_updated"
        | "consent_text_published"
        | "setting_updated"
        | "notification_block_revoked"
        | "user_updated"
        | "user_deactivated"
        | "user_reactivated"
        | "user_password_reset"
        | "role_created"
        | "role_updated"
        | "role_deleted"
        | "knowledge_created"
        | "knowledge_updated"
        | "knowledge_activated"
        | "knowledge_deactivated";
      app_role: "admin" | "ceo" | "pm" | "tech_lead" | "comercial" | "financeiro" | "viewer";
      broadcast_recipient_status: "pending" | "sending" | "sent" | "error" | "blocked";
      broadcast_source: "normative" | "communication" | "market_bulletin" | "lecture";
      broadcast_status: "running" | "done" | "failed";
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
      event_audit_action:
        | "event_created"
        | "event_updated"
        | "event_activated"
        | "event_deactivated"
        | "event_image_uploaded"
        | "event_image_replaced"
        | "event_segments_updated"
        | "event_dispatch_started"
        | "event_dispatch_completed";
      event_dispatch_status: "running" | "completed" | "failed";
      event_recipient_status:
        | "pending"
        | "sending"
        | "sent"
        | "delivered"
        | "read"
        | "error"
        | "blocked";
      event_status: "active" | "inactive";
      intelligence_outcome:
        | "tool_ok"
        | "tool_empty"
        | "tool_error"
        | "confirmed"
        | "message"
        | "handoff";
      knowledge_status: "active" | "inactive";
      lead_status: "new" | "in_contact" | "qualified" | "discarded";
      lecture_audit_action:
        | "lecture_created"
        | "lecture_updated"
        | "lecture_status_changed"
        | "lecture_rescheduled"
        | "lecture_responsible_assigned"
        | "lecture_speaker_assigned"
        | "lecture_cancelled"
        | "lecture_rejected"
        | "lecture_outcome_registered";
      lecture_format: "in_person" | "online" | "hybrid";
      lecture_origin: "chatbot" | "internal";
      lecture_priority: "low" | "normal" | "high" | "urgent";
      lecture_status:
        | "requested"
        | "under_review"
        | "approved"
        | "rejected"
        | "planned"
        | "confirmed"
        | "held"
        | "cancelled";
      lecture_type: "company" | "associate" | "university" | "other";
      market_bulletin_audit_action:
        | "bulletin_created"
        | "bulletin_updated"
        | "version_uploaded"
        | "version_activated"
        | "version_deactivated"
        | "version_viewed"
        | "version_downloaded";
      market_bulletin_status_reason: "manual" | "superseded";
      market_bulletin_version_status: "active" | "inactive";
      member_origin: "application" | "import" | "manual";
      member_status: "active" | "inactive" | "suspended";
      membership_application_status: "pending" | "in_review" | "approved" | "rejected";
      membership_audit_action:
        | "application_submitted"
        | "application_review_started"
        | "application_approved"
        | "application_rejected"
        | "application_reopened"
        | "member_created"
        | "member_linked"
        | "member_updated"
        | "member_notifications_resumed";
      membership_profile_type: "criador" | "tecnico" | "empresa" | "universidade";
      survey_answer_type:
        | "single_choice"
        | "multiple_choice"
        | "yes_no"
        | "scale"
        | "text"
        | "rating";
      survey_audience_dimension:
        | "all"
        | "segment"
        | "category"
        | "region"
        | "profile"
        | "portfolio"
        | "contact";
      survey_audit_action:
        | "survey_created"
        | "survey_updated"
        | "survey_question_updated"
        | "survey_audience_updated"
        | "survey_scheduled"
        | "survey_activated"
        | "survey_dispatched"
        | "survey_closed"
        | "survey_cancelled"
        | "survey_response_registered"
        | "survey_dispatch_completed";
      survey_channel: "whatsapp";
      survey_context_status: "awaiting_reply" | "answered" | "expired" | "released" | "superseded";
      survey_dispatch_status: "pending" | "running" | "completed" | "failed";
      survey_recipient_status:
        | "pending"
        | "sending"
        | "sent"
        | "delivered"
        | "read"
        | "responded"
        | "error";
      survey_response_outcome:
        | "registered"
        | "already_answered"
        | "invalid_option"
        | "not_active"
        | "closed"
        | "cancelled"
        | "not_found";
      survey_status: "draft" | "scheduled" | "active" | "closed" | "cancelled";
      whatsapp_delivery_status: "pending" | "sent" | "delivered" | "read" | "failed";
      whatsapp_direction: "inbound" | "outbound";
      whatsapp_media_status: "pending" | "stored" | "failed" | "too_large" | "unsupported";
      whatsapp_message_kind:
        | "text"
        | "image"
        | "audio"
        | "video"
        | "document"
        | "sticker"
        | "location"
        | "contact"
        | "unsupported";
      whatsapp_message_origin: "contact" | "agent" | "bot" | "phone";
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
      admin_audit_action: [
        "user_role_changed",
        "user_invited",
        "segment_updated",
        "consent_text_published",
        "setting_updated",
        "notification_block_revoked",
        "user_updated",
        "user_deactivated",
        "user_reactivated",
        "user_password_reset",
        "role_created",
        "role_updated",
        "role_deleted",
        "knowledge_created",
        "knowledge_updated",
        "knowledge_activated",
        "knowledge_deactivated",
      ],
      app_role: ["admin", "ceo", "pm", "tech_lead", "comercial", "financeiro", "viewer"],
      broadcast_recipient_status: ["pending", "sending", "sent", "error", "blocked"],
      broadcast_source: ["normative", "communication", "market_bulletin", "lecture"],
      broadcast_status: ["running", "done", "failed"],
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
      event_audit_action: [
        "event_created",
        "event_updated",
        "event_activated",
        "event_deactivated",
        "event_image_uploaded",
        "event_image_replaced",
        "event_segments_updated",
        "event_dispatch_started",
        "event_dispatch_completed",
      ],
      event_dispatch_status: ["running", "completed", "failed"],
      event_recipient_status: [
        "pending",
        "sending",
        "sent",
        "delivered",
        "read",
        "error",
        "blocked",
      ],
      event_status: ["active", "inactive"],
      intelligence_outcome: [
        "tool_ok",
        "tool_empty",
        "tool_error",
        "confirmed",
        "message",
        "handoff",
      ],
      knowledge_status: ["active", "inactive"],
      lead_status: ["new", "in_contact", "qualified", "discarded"],
      lecture_audit_action: [
        "lecture_created",
        "lecture_updated",
        "lecture_status_changed",
        "lecture_rescheduled",
        "lecture_responsible_assigned",
        "lecture_speaker_assigned",
        "lecture_cancelled",
        "lecture_rejected",
        "lecture_outcome_registered",
      ],
      lecture_format: ["in_person", "online", "hybrid"],
      lecture_origin: ["chatbot", "internal"],
      lecture_priority: ["low", "normal", "high", "urgent"],
      lecture_status: [
        "requested",
        "under_review",
        "approved",
        "rejected",
        "planned",
        "confirmed",
        "held",
        "cancelled",
      ],
      lecture_type: ["company", "associate", "university", "other"],
      market_bulletin_audit_action: [
        "bulletin_created",
        "bulletin_updated",
        "version_uploaded",
        "version_activated",
        "version_deactivated",
        "version_viewed",
        "version_downloaded",
      ],
      market_bulletin_status_reason: ["manual", "superseded"],
      market_bulletin_version_status: ["active", "inactive"],
      member_origin: ["application", "import", "manual"],
      member_status: ["active", "inactive", "suspended"],
      membership_application_status: ["pending", "in_review", "approved", "rejected"],
      membership_audit_action: [
        "application_submitted",
        "application_review_started",
        "application_approved",
        "application_rejected",
        "application_reopened",
        "member_created",
        "member_linked",
        "member_updated",
        "member_notifications_resumed",
      ],
      membership_profile_type: ["criador", "tecnico", "empresa", "universidade"],
      survey_answer_type: ["single_choice", "multiple_choice", "yes_no", "scale", "text", "rating"],
      survey_audience_dimension: [
        "all",
        "segment",
        "category",
        "region",
        "profile",
        "portfolio",
        "contact",
      ],
      survey_audit_action: [
        "survey_created",
        "survey_updated",
        "survey_question_updated",
        "survey_audience_updated",
        "survey_scheduled",
        "survey_activated",
        "survey_dispatched",
        "survey_closed",
        "survey_cancelled",
        "survey_response_registered",
        "survey_dispatch_completed",
      ],
      survey_channel: ["whatsapp"],
      survey_context_status: ["awaiting_reply", "answered", "expired", "released", "superseded"],
      survey_dispatch_status: ["pending", "running", "completed", "failed"],
      survey_recipient_status: [
        "pending",
        "sending",
        "sent",
        "delivered",
        "read",
        "responded",
        "error",
      ],
      survey_response_outcome: [
        "registered",
        "already_answered",
        "invalid_option",
        "not_active",
        "closed",
        "cancelled",
        "not_found",
      ],
      survey_status: ["draft", "scheduled", "active", "closed", "cancelled"],
      whatsapp_delivery_status: ["pending", "sent", "delivered", "read", "failed"],
      whatsapp_direction: ["inbound", "outbound"],
      whatsapp_media_status: ["pending", "stored", "failed", "too_large", "unsupported"],
      whatsapp_message_kind: [
        "text",
        "image",
        "audio",
        "video",
        "document",
        "sticker",
        "location",
        "contact",
        "unsupported",
      ],
      whatsapp_message_origin: ["contact", "agent", "bot", "phone"],
    },
  },
} as const;
