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
      assert_event_segments: {
        Args: { p_segment_ids: string[] };
        Returns: undefined;
      };
      assert_lecture_profile: {
        Args: { p_profile_id: string };
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
      current_actor_name: { Args: never; Returns: string };
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
      event_today: { Args: never; Returns: string };
      expand_event_segments: {
        Args: { p_segment_ids: string[] };
        Returns: string[];
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
      is_admin: { Args: never; Returns: boolean };
      lock_document: { Args: { p_document_id: string }; Returns: undefined };
      lock_event: { Args: { p_event_id: string }; Returns: undefined };
      lock_lecture: { Args: { p_lecture_id: string }; Returns: undefined };
      lock_market_bulletin: {
        Args: { p_bulletin_id: string };
        Returns: undefined;
      };
      market_bulletin_version_name: {
        Args: { p_date: string };
        Returns: string;
      };
      next_lecture_protocol: { Args: never; Returns: string };
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
      set_event_status: {
        Args: { p_command: string; p_event_id: string };
        Returns: {
          created_at: string;
          created_by: string | null;
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
      update_event: {
        Args: {
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
      event_audit_action:
        | "event_created"
        | "event_updated"
        | "event_activated"
        | "event_deactivated"
        | "event_image_uploaded"
        | "event_image_replaced"
        | "event_segments_updated";
      event_status: "active" | "inactive";
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
      event_audit_action: [
        "event_created",
        "event_updated",
        "event_activated",
        "event_deactivated",
        "event_image_uploaded",
        "event_image_replaced",
        "event_segments_updated",
      ],
      event_status: ["active", "inactive"],
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
    },
  },
} as const;
