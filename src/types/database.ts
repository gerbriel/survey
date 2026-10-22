export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13"
  }
  public: {
    Tables: {
      access_requests: {
        Row: {
          created_at: string
          department: string | null
          id: string
          invite_id: string | null
          name: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          department?: string | null
          id?: string
          invite_id?: string | null
          name: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          department?: string | null
          id?: string
          invite_id?: string | null
          name?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "access_requests_invite_id_fkey"
            columns: ["invite_id"]
            referencedRelation: "platform_invites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_requests_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_log: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          diff: NonNullable<Json>
          entity: string
          entity_id: string | null
          id: number
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          diff?: NonNullable<Json>
          entity: string
          entity_id?: string | null
          id?: never
          workspace_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          diff?: NonNullable<Json>
          entity?: string
          entity_id?: string | null
          id?: never
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_fkey"
            columns: ["actor"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      answers: {
        Row: {
          id: number
          question_key: string
          response_id: string
          survey_id: string
          survey_version_id: string
          value_date: string | null
          value_json: Json | null
          value_number: number | null
          value_text: string | null
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          id?: never
          question_key: string
          response_id: string
          survey_id: string
          survey_version_id: string
          value_date?: string | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
          workspace_id: string
        }
        Update: {
          id?: never
          question_key?: string
          response_id?: string
          survey_id?: string
          survey_version_id?: string
          value_date?: string | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "answers_response_id_fkey"
            columns: ["response_id"]
            referencedRelation: "responses"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_aliases: {
        Row: {
          alias_id: string
          contact_id: string
          email: string | null
          merged_at: string
          merged_by: string | null
          phone: string | null
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          alias_id: string
          contact_id: string
          email?: string | null
          merged_at?: string
          merged_by?: string | null
          phone?: string | null
          workspace_id: string
        }
        Update: {
          alias_id?: string
          contact_id?: string
          email?: string | null
          merged_at?: string
          merged_by?: string | null
          phone?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_aliases_contact_id_fkey"
            columns: ["contact_id"]
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_aliases_merged_by_fkey"
            columns: ["merged_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_aliases_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_duplicate_dismissals: {
        Row: {
          contact_a: string
          contact_b: string
          created_at: string
          dismissed_by: string | null
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          contact_a: string
          contact_b: string
          created_at?: string
          dismissed_by?: string | null
          workspace_id: string
        }
        Update: {
          contact_a?: string
          contact_b?: string
          created_at?: string
          dismissed_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_duplicate_dismissals_contact_a_fkey"
            columns: ["contact_a"]
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_duplicate_dismissals_contact_b_fkey"
            columns: ["contact_b"]
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_duplicate_dismissals_dismissed_by_fkey"
            columns: ["dismissed_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_duplicate_dismissals_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_field_defs: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          key: string
          label: string
          options: Json | null
          position: number
          type: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          key: string
          label: string
          options?: Json | null
          position?: number
          type: string
          workspace_id: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          key?: string
          label?: string
          options?: Json | null
          position?: number
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_field_defs_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_imports: {
        Row: {
          created: number
          created_at: string
          created_by: string | null
          finished_at: string | null
          id: string
          invalid: number
          mapping: NonNullable<Json>
          options: NonNullable<Json>
          skipped: number
          status: string
          storage_path: string | null
          token_survey_id: string | null
          updated: number
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          created?: number
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          invalid?: number
          mapping?: NonNullable<Json>
          options?: NonNullable<Json>
          skipped?: number
          status?: string
          storage_path?: string | null
          token_survey_id?: string | null
          updated?: number
          workspace_id: string
        }
        Update: {
          created?: number
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          invalid?: number
          mapping?: NonNullable<Json>
          options?: NonNullable<Json>
          skipped?: number
          status?: string
          storage_path?: string | null
          token_survey_id?: string | null
          updated?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_imports_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_imports_token_survey_id_fkey"
            columns: ["token_survey_id"]
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_imports_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_notes: {
        Row: {
          author: string | null
          body: string
          contact_id: string
          created_at: string
          id: string
          updated_at: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          author?: string | null
          body: string
          contact_id: string
          created_at?: string
          id?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author?: string | null
          body?: string
          contact_id?: string
          created_at?: string
          id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_notes_author_fkey"
            columns: ["author"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_notes_contact_id_fkey"
            columns: ["contact_id"]
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_notes_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_views: {
        Row: {
          builtin: boolean
          columns: string[]
          created_at: string
          created_by: string | null
          filters: NonNullable<Json>
          id: string
          name: string
          shared: boolean
          sort: NonNullable<Json>
          updated_at: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          builtin?: boolean
          columns?: string[]
          created_at?: string
          created_by?: string | null
          filters?: NonNullable<Json>
          id?: string
          name: string
          shared?: boolean
          sort?: NonNullable<Json>
          updated_at?: string
          workspace_id: string
        }
        Update: {
          builtin?: boolean
          columns?: string[]
          created_at?: string
          created_by?: string | null
          filters?: NonNullable<Json>
          id?: string
          name?: string
          shared?: boolean
          sort?: NonNullable<Json>
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_views_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_views_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          company: string | null
          created_at: string
          created_by: string | null
          custom: NonNullable<Json>
          deleted_at: string | null
          email: string | null
          first_name: string | null
          follow_up_at: string | null
          follow_up_note: string | null
          id: string
          last_name: string | null
          last_response_at: string | null
          lead_status: Database["public"]["Enums"]["lead_status"]
          lead_status_changed_at: string | null
          merged_at: string | null
          merged_into: string | null
          owner_id: string | null
          phone: string | null
          response_count: number
          source: string | null
          status: string
          tags: string[]
          updated_at: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          company?: string | null
          created_at?: string
          created_by?: string | null
          custom?: NonNullable<Json>
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          follow_up_at?: string | null
          follow_up_note?: string | null
          id?: string
          last_name?: string | null
          last_response_at?: string | null
          lead_status?: Database["public"]["Enums"]["lead_status"]
          lead_status_changed_at?: string | null
          merged_at?: string | null
          merged_into?: string | null
          owner_id?: string | null
          phone?: string | null
          response_count?: number
          source?: string | null
          status?: string
          tags?: string[]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          company?: string | null
          created_at?: string
          created_by?: string | null
          custom?: NonNullable<Json>
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          follow_up_at?: string | null
          follow_up_note?: string | null
          id?: string
          last_name?: string | null
          last_response_at?: string | null
          lead_status?: Database["public"]["Enums"]["lead_status"]
          lead_status_changed_at?: string | null
          merged_at?: string | null
          merged_into?: string | null
          owner_id?: string | null
          phone?: string | null
          response_count?: number
          source?: string | null
          status?: string
          tags?: string[]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_merged_into_fkey"
            columns: ["merged_into"]
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_owner_id_fkey"
            columns: ["owner_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      event_daily: {
        Row: {
          count: number
          day: string
          distinct_rids: number
          question_key: string
          survey_id: string
          survey_version_id: string
          type: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          count: number
          day: string
          distinct_rids: number
          question_key?: string
          survey_id: string
          survey_version_id: string
          type: string
          workspace_id: string
        }
        Update: {
          count?: number
          day?: string
          distinct_rids?: number
          question_key?: string
          survey_id?: string
          survey_version_id?: string
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_daily_survey_id_fkey"
            columns: ["survey_id"]
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_daily_survey_version_id_fkey"
            columns: ["survey_version_id"]
            referencedRelation: "survey_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_daily_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          id: number
          meta: NonNullable<Json>
          occurred_at: string
          question_key: string | null
          respondent_hash: string | null
          response_id: string | null
          survey_id: string
          survey_version_id: string
          type: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          id?: never
          meta?: NonNullable<Json>
          occurred_at?: string
          question_key?: string | null
          respondent_hash?: string | null
          response_id?: string | null
          survey_id: string
          survey_version_id: string
          type: string
          workspace_id: string
        }
        Update: {
          id?: never
          meta?: NonNullable<Json>
          occurred_at?: string
          question_key?: string | null
          respondent_hash?: string | null
          response_id?: string | null
          survey_id?: string
          survey_version_id?: string
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_response_id_fkey"
            columns: ["response_id"]
            referencedRelation: "responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_survey_id_fkey"
            columns: ["survey_id"]
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_survey_version_id_fkey"
            columns: ["survey_version_id"]
            referencedRelation: "survey_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      export_jobs: {
        Row: {
          created_at: string
          created_by: string | null
          cursor: Json | null
          filters: NonNullable<Json>
          finished_at: string | null
          format: string
          id: string
          kind: string
          row_count: number | null
          status: string
          storage_path: string | null
          survey_id: string | null
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          cursor?: Json | null
          filters?: NonNullable<Json>
          finished_at?: string | null
          format: string
          id?: string
          kind: string
          row_count?: number | null
          status?: string
          storage_path?: string | null
          survey_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          cursor?: Json | null
          filters?: NonNullable<Json>
          finished_at?: string | null
          format?: string
          id?: string
          kind?: string
          row_count?: number | null
          status?: string
          storage_path?: string | null
          survey_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_jobs_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_jobs_survey_id_fkey"
            columns: ["survey_id"]
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_secrets: {
        Row: {
          created_at: string
          name: string
          value: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          name: string
          value: string
        }
        Update: {
          created_at?: string
          name?: string
          value?: string
        }
        Relationships: []
      }
      platform_audit_log: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          details: NonNullable<Json>
          id: number
          target_id: string | null
          target_type: string
        }
        ComputedFields: never
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          details?: NonNullable<Json>
          id?: never
          target_id?: string | null
          target_type: string
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          details?: NonNullable<Json>
          id?: never
          target_id?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_audit_log_actor_fkey"
            columns: ["actor"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_invites: {
        Row: {
          created_at: string
          email: string | null
          expires_at: string
          id: string
          invited_by: string | null
          note: string | null
          revoked_at: string | null
          token: string
          used_at: string | null
          used_by: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by?: string | null
          note?: string | null
          revoked_at?: string | null
          token?: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_by?: string | null
          note?: string | null
          revoked_at?: string | null
          token?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_invites_invited_by_fkey"
            columns: ["invited_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_invites_used_by_fkey"
            columns: ["used_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          id: boolean
          privacy_notice_md: string
          updated_at: string
          updated_by: string | null
        }
        ComputedFields: never
        Insert: {
          id?: boolean
          privacy_notice_md?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: boolean
          privacy_notice_md?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_settings_updated_by_fkey"
            columns: ["updated_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          is_platform_admin: boolean
          last_workspace_id: string | null
          status: Database["public"]["Enums"]["profile_status"]
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id: string
          is_platform_admin?: boolean
          last_workspace_id?: string | null
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_platform_admin?: boolean
          last_workspace_id?: string | null
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_last_workspace_id_fkey"
            columns: ["last_workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          config: NonNullable<Json>
          id: string
          is_pii: boolean
          label: string
          label_hash: string
          options: Json | null
          page_index: number
          position: number
          question_key: string
          required: boolean
          survey_id: string
          survey_version_id: string
          type: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          config?: NonNullable<Json>
          id?: string
          is_pii?: boolean
          label: string
          label_hash: string
          options?: Json | null
          page_index: number
          position: number
          question_key: string
          required?: boolean
          survey_id: string
          survey_version_id: string
          type: string
          workspace_id: string
        }
        Update: {
          config?: NonNullable<Json>
          id?: string
          is_pii?: boolean
          label?: string
          label_hash?: string
          options?: Json | null
          page_index?: number
          position?: number
          question_key?: string
          required?: boolean
          survey_id?: string
          survey_version_id?: string
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_survey_id_fkey"
            columns: ["survey_id"]
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_survey_version_id_fkey"
            columns: ["survey_version_id"]
            referencedRelation: "survey_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_events: {
        Row: {
          at: string
          bucket: string
          key: string
        }
        ComputedFields: never
        Insert: {
          at?: string
          bucket: string
          key: string
        }
        Update: {
          at?: string
          bucket?: string
          key?: string
        }
        Relationships: []
      }
      report_shares: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          last_viewed_at: string | null
          password_hash: string | null
          report_id: string
          revoked_at: string | null
          token: string
          view_count: number
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          last_viewed_at?: string | null
          password_hash?: string | null
          report_id: string
          revoked_at?: string | null
          token?: string
          view_count?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          last_viewed_at?: string | null
          password_hash?: string | null
          report_id?: string
          revoked_at?: string | null
          token?: string
          view_count?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_shares_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_shares_report_id_fkey"
            columns: ["report_id"]
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_shares_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      report_widgets: {
        Row: {
          chart_type: string
          cross_tab_key: string | null
          id: string
          metric: string | null
          options: NonNullable<Json>
          position: number
          question_key: string | null
          report_id: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          chart_type: string
          cross_tab_key?: string | null
          id?: string
          metric?: string | null
          options?: NonNullable<Json>
          position: number
          question_key?: string | null
          report_id: string
          workspace_id: string
        }
        Update: {
          chart_type?: string
          cross_tab_key?: string | null
          id?: string
          metric?: string | null
          options?: NonNullable<Json>
          position?: number
          question_key?: string | null
          report_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_widgets_report_id_fkey"
            columns: ["report_id"]
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_widgets_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          created_by: string | null
          filters: NonNullable<Json>
          id: string
          is_default: boolean
          name: string
          survey_id: string
          updated_at: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          filters?: NonNullable<Json>
          id?: string
          is_default?: boolean
          name: string
          survey_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          filters?: NonNullable<Json>
          id?: string
          is_default?: boolean
          name?: string
          survey_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_survey_id_fkey"
            columns: ["survey_id"]
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      respondent_tokens: {
        Row: {
          contact_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          max_responses: number
          revoked_at: string | null
          survey_id: string
          token: string
          used_count: number
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          contact_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_responses?: number
          revoked_at?: string | null
          survey_id: string
          token?: string
          used_count?: number
          workspace_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_responses?: number
          revoked_at?: string | null
          survey_id?: string
          token?: string
          used_count?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "respondent_tokens_contact_id_fkey"
            columns: ["contact_id"]
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "respondent_tokens_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "respondent_tokens_survey_id_fkey"
            columns: ["survey_id"]
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "respondent_tokens_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      response_files: {
        Row: {
          attached_at: string | null
          created_at: string
          declared_mime: string
          declared_size: number
          id: string
          mime_type: string | null
          moved_at: string | null
          object_path: string
          original_name: string
          pending_response_id: string | null
          question_key: string
          response_id: string | null
          size_bytes: number | null
          status: string
          survey_id: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          attached_at?: string | null
          created_at?: string
          declared_mime: string
          declared_size: number
          id?: string
          mime_type?: string | null
          moved_at?: string | null
          object_path: string
          original_name: string
          pending_response_id?: string | null
          question_key: string
          response_id?: string | null
          size_bytes?: number | null
          status?: string
          survey_id: string
          workspace_id: string
        }
        Update: {
          attached_at?: string | null
          created_at?: string
          declared_mime?: string
          declared_size?: number
          id?: string
          mime_type?: string | null
          moved_at?: string | null
          object_path?: string
          original_name?: string
          pending_response_id?: string | null
          question_key?: string
          response_id?: string | null
          size_bytes?: number | null
          status?: string
          survey_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "response_files_pending_response_id_fkey"
            columns: ["pending_response_id"]
            referencedRelation: "responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "response_files_response_id_fkey"
            columns: ["response_id"]
            referencedRelation: "responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "response_files_survey_id_fkey"
            columns: ["survey_id"]
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "response_files_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      responses: {
        Row: {
          anonymized_at: string | null
          contact_id: string | null
          id: string
          identity_source: string | null
          ip: unknown
          last_question_key: string | null
          metadata: NonNullable<Json>
          raw: NonNullable<Json>
          respondent_hash: string | null
          respondent_token_id: string | null
          resume_token_hash: string | null
          score: number | null
          score_max: number | null
          started_at: string
          status: Database["public"]["Enums"]["response_status"]
          submitted_at: string | null
          survey_id: string
          survey_version_id: string
          updated_at: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          anonymized_at?: string | null
          contact_id?: string | null
          id?: string
          identity_source?: string | null
          ip?: unknown
          last_question_key?: string | null
          metadata?: NonNullable<Json>
          raw?: NonNullable<Json>
          respondent_hash?: string | null
          respondent_token_id?: string | null
          resume_token_hash?: string | null
          score?: number | null
          score_max?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["response_status"]
          submitted_at?: string | null
          survey_id: string
          survey_version_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          anonymized_at?: string | null
          contact_id?: string | null
          id?: string
          identity_source?: string | null
          ip?: unknown
          last_question_key?: string | null
          metadata?: NonNullable<Json>
          raw?: NonNullable<Json>
          respondent_hash?: string | null
          respondent_token_id?: string | null
          resume_token_hash?: string | null
          score?: number | null
          score_max?: number | null
          started_at?: string
          status?: Database["public"]["Enums"]["response_status"]
          submitted_at?: string | null
          survey_id?: string
          survey_version_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "responses_contact_id_fkey"
            columns: ["contact_id"]
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "responses_respondent_token_id_fkey"
            columns: ["respondent_token_id"]
            referencedRelation: "respondent_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "responses_survey_id_fkey"
            columns: ["survey_id"]
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "responses_survey_version_id_fkey"
            columns: ["survey_version_id"]
            referencedRelation: "survey_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "responses_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      stopwords: {
        Row: {
          lang: string
          word: string
        }
        ComputedFields: never
        Insert: {
          lang: string
          word: string
        }
        Update: {
          lang?: string
          word?: string
        }
        Relationships: []
      }
      storage_deletions: {
        Row: {
          attempts: number
          bucket: string
          done_at: string | null
          enqueued_at: string
          id: number
          last_error: string | null
          path: string
          reason: string
          workspace_id: string | null
        }
        ComputedFields: never
        Insert: {
          attempts?: number
          bucket: string
          done_at?: string | null
          enqueued_at?: string
          id?: never
          last_error?: string | null
          path: string
          reason: string
          workspace_id?: string | null
        }
        Update: {
          attempts?: number
          bucket?: string
          done_at?: string | null
          enqueued_at?: string
          id?: never
          last_error?: string | null
          path?: string
          reason?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      submission_idempotency: {
        Row: {
          created_at: string
          key: string
          response_id: string | null
          result: Json | null
          survey_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          key: string
          response_id?: string | null
          result?: Json | null
          survey_id: string
        }
        Update: {
          created_at?: string
          key?: string
          response_id?: string | null
          result?: Json | null
          survey_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submission_idempotency_response_id_fkey"
            columns: ["response_id"]
            referencedRelation: "responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submission_idempotency_survey_id_fkey"
            columns: ["survey_id"]
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_aliases: {
        Row: {
          alias: string
          created_at: string
          created_by: string | null
          id: string
          retired_at: string | null
          survey_id: string | null
          workspace_id: string | null
        }
        ComputedFields: never
        Insert: {
          alias: string
          created_at?: string
          created_by?: string | null
          id?: string
          retired_at?: string | null
          survey_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          alias?: string
          created_at?: string
          created_by?: string | null
          id?: string
          retired_at?: string | null
          survey_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "survey_aliases_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_aliases_survey_id_fkey"
            columns: ["survey_id"]
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_aliases_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          kind: string
          survey_id: string
          user_id: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          kind: string
          survey_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          kind?: string
          survey_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_assignments_survey_id_fkey"
            columns: ["survey_id"]
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_assignments_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_assignments_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_templates: {
        Row: {
          created_at: string
          created_by: string | null
          definition: NonNullable<Json>
          description: string | null
          id: string
          name: string
          workspace_id: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          definition: NonNullable<Json>
          description?: string | null
          id?: string
          name: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          definition?: NonNullable<Json>
          description?: string | null
          id?: string
          name?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "survey_templates_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_versions: {
        Row: {
          created_at: string
          created_from_version_id: string | null
          definition: NonNullable<Json>
          definition_hash: string | null
          id: string
          locked_at: string | null
          locked_by: string | null
          public_definition: Json | null
          published_at: string | null
          published_by: string | null
          revision: number
          status: Database["public"]["Enums"]["version_status"]
          survey_id: string
          updated_at: string
          version_no: number
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_from_version_id?: string | null
          definition?: NonNullable<Json>
          definition_hash?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          public_definition?: Json | null
          published_at?: string | null
          published_by?: string | null
          revision?: number
          status?: Database["public"]["Enums"]["version_status"]
          survey_id: string
          updated_at?: string
          version_no: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_from_version_id?: string | null
          definition?: NonNullable<Json>
          definition_hash?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          public_definition?: Json | null
          published_at?: string | null
          published_by?: string | null
          revision?: number
          status?: Database["public"]["Enums"]["version_status"]
          survey_id?: string
          updated_at?: string
          version_no?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_versions_created_from_version_id_fkey"
            columns: ["created_from_version_id"]
            referencedRelation: "survey_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_versions_locked_by_fkey"
            columns: ["locked_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_versions_published_by_fkey"
            columns: ["published_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_versions_survey_id_fkey"
            columns: ["survey_id"]
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      surveys: {
        Row: {
          admin_closed_at: string | null
          admin_closed_reason: string | null
          allow_indexing: boolean
          archived_at: string | null
          closed_message: string | null
          closes_at: string | null
          complete_count: number
          created_at: string
          created_by: string | null
          current_draft_version_id: string | null
          excluded_pixel_ids: string[]
          id: string
          identity_phone_key: string | null
          identity_question_key: string | null
          latest_published_version_id: string | null
          og_description: string | null
          og_image_path: string | null
          og_title: string | null
          opens_at: string | null
          response_cap: number | null
          settings: NonNullable<Json>
          slug: string
          state: Database["public"]["Enums"]["survey_state"]
          title: string
          trust_hidden_identity: boolean
          updated_at: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          admin_closed_at?: string | null
          admin_closed_reason?: string | null
          allow_indexing?: boolean
          archived_at?: string | null
          closed_message?: string | null
          closes_at?: string | null
          complete_count?: number
          created_at?: string
          created_by?: string | null
          current_draft_version_id?: string | null
          excluded_pixel_ids?: string[]
          id?: string
          identity_phone_key?: string | null
          identity_question_key?: string | null
          latest_published_version_id?: string | null
          og_description?: string | null
          og_image_path?: string | null
          og_title?: string | null
          opens_at?: string | null
          response_cap?: number | null
          settings?: NonNullable<Json>
          slug?: string
          state?: Database["public"]["Enums"]["survey_state"]
          title?: string
          trust_hidden_identity?: boolean
          updated_at?: string
          workspace_id: string
        }
        Update: {
          admin_closed_at?: string | null
          admin_closed_reason?: string | null
          allow_indexing?: boolean
          archived_at?: string | null
          closed_message?: string | null
          closes_at?: string | null
          complete_count?: number
          created_at?: string
          created_by?: string | null
          current_draft_version_id?: string | null
          excluded_pixel_ids?: string[]
          id?: string
          identity_phone_key?: string | null
          identity_question_key?: string | null
          latest_published_version_id?: string | null
          og_description?: string | null
          og_image_path?: string | null
          og_title?: string | null
          opens_at?: string | null
          response_cap?: number | null
          settings?: NonNullable<Json>
          slug?: string
          state?: Database["public"]["Enums"]["survey_state"]
          title?: string
          trust_hidden_identity?: boolean
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "surveys_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surveys_current_draft_version_id_fkey"
            columns: ["current_draft_version_id"]
            referencedRelation: "survey_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surveys_latest_published_version_id_fkey"
            columns: ["latest_published_version_id"]
            referencedRelation: "survey_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surveys_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_images: {
        Row: {
          bytes: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          height: number | null
          id: string
          kind: string
          label: string
          mime: string
          path: string
          source: string
          width: number | null
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          bytes: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          height?: number | null
          id?: string
          kind?: string
          label?: string
          mime: string
          path: string
          source?: string
          width?: number | null
          workspace_id: string
        }
        Update: {
          bytes?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          height?: number | null
          id?: string
          kind?: string
          label?: string
          mime?: string
          path?: string
          source?: string
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_images_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_images_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invites: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          label: string | null
          max_uses: number
          revoked_at: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          token: string
          used_count: number
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          label?: string | null
          max_uses?: number
          revoked_at?: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          token?: string
          used_count?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          label?: string | null
          max_uses?: number
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          token?: string
          used_count?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_limits: {
        Row: {
          max_definition_bytes: number | null
          max_file_bytes: number | null
          max_files_per_response: number | null
          max_questions: number | null
          note: string | null
          rate_limit_per_hour: number | null
          raw_script_pixels_allowed: boolean | null
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          max_definition_bytes?: number | null
          max_file_bytes?: number | null
          max_files_per_response?: number | null
          max_questions?: number | null
          note?: string | null
          rate_limit_per_hour?: number | null
          raw_script_pixels_allowed?: boolean | null
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          max_definition_bytes?: number | null
          max_file_bytes?: number | null
          max_files_per_response?: number | null
          max_questions?: number | null
          note?: string | null
          rate_limit_per_hour?: number | null
          raw_script_pixels_allowed?: boolean | null
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_limits_updated_by_fkey"
            columns: ["updated_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_limits_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          invite_id: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          invite_id?: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          invite_id?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_pixels: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          label: string
          parsed: Json | null
          type: Database["public"]["Enums"]["pixel_type"]
          updated_at: string
          value: string
          workspace_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          label: string
          parsed?: Json | null
          type: Database["public"]["Enums"]["pixel_type"]
          updated_at?: string
          value: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          label?: string
          parsed?: Json | null
          type?: Database["public"]["Enums"]["pixel_type"]
          updated_at?: string
          value?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_pixels_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_pixels_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_requests: {
        Row: {
          created_at: string
          department_name: string
          id: string
          purpose: string | null
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          workspace_id: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          department_name: string
          id?: string
          purpose?: string | null
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          department_name?: string
          id?: string
          purpose?: string | null
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_requests_requested_by_fkey"
            columns: ["requested_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_slug_history: {
        Row: {
          released_at: string
          slug: string
          workspace_id: string | null
        }
        ComputedFields: never
        Insert: {
          released_at?: string
          slug: string
          workspace_id?: string | null
        }
        Update: {
          released_at?: string
          slug?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_slug_history_workspace_id_fkey"
            columns: ["workspace_id"]
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          archived_at: string | null
          consent_default_text: string | null
          created_at: string
          created_by: string | null
          default_closed_message: string | null
          default_country: string
          default_theme: NonNullable<Json>
          deleted_at: string | null
          deleted_by: string | null
          id: string
          logo_path: string | null
          name: string
          pixel_consent_mode: Database["public"]["Enums"]["pixel_consent_mode"]
          pixel_notice_ack_at: string | null
          pixel_notice_ack_by: string | null
          privacy_notice_url: string | null
          retention_days: number | null
          show_powered_by: boolean
          slug: string
          storage_bytes_used: number
          storage_reconciled_at: string | null
          store_ip: boolean
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          archived_at?: string | null
          consent_default_text?: string | null
          created_at?: string
          created_by?: string | null
          default_closed_message?: string | null
          default_country?: string
          default_theme?: NonNullable<Json>
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          logo_path?: string | null
          name: string
          pixel_consent_mode?: Database["public"]["Enums"]["pixel_consent_mode"]
          pixel_notice_ack_at?: string | null
          pixel_notice_ack_by?: string | null
          privacy_notice_url?: string | null
          retention_days?: number | null
          show_powered_by?: boolean
          slug: string
          storage_bytes_used?: number
          storage_reconciled_at?: string | null
          store_ip?: boolean
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          consent_default_text?: string | null
          created_at?: string
          created_by?: string | null
          default_closed_message?: string | null
          default_country?: string
          default_theme?: NonNullable<Json>
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          logo_path?: string | null
          name?: string
          pixel_consent_mode?: Database["public"]["Enums"]["pixel_consent_mode"]
          pixel_notice_ack_at?: string | null
          pixel_notice_ack_by?: string | null
          privacy_notice_url?: string | null
          retention_days?: number | null
          show_powered_by?: boolean
          slug?: string
          storage_bytes_used?: number
          storage_reconciled_at?: string | null
          store_ip?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspaces_deleted_by_fkey"
            columns: ["deleted_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspaces_pixel_notice_ack_by_fkey"
            columns: ["pixel_notice_ack_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_workspace_invite: { Args: { p_token: string }; Returns: Json }
      add_survey_collaborator: {
        Args: { p_survey_id: string; p_user_id: string }
        Returns: undefined
      }
      add_workspace_member: {
        Args: {
          p_role: Database["public"]["Enums"]["workspace_role"]
          p_user_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      admin_add_workspace_member: {
        Args: {
          p_role: Database["public"]["Enums"]["workspace_role"]
          p_user_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      admin_approve_access_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      admin_close_survey: {
        Args: { p_reason: string; p_survey_id: string }
        Returns: undefined
      }
      admin_create_workspace: {
        Args: {
          p_name: string
          p_owner: string
          p_request_id?: string
          p_slug: string
        }
        Returns: string
      }
      admin_dismiss_access_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      admin_dismiss_workspace_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      admin_issue_platform_invite: {
        Args: { p_email?: string; p_expires_in_days?: number; p_note?: string }
        Returns: {
          created_at: string
          email: string | null
          expires_at: string
          id: string
          invited_by: string | null
          note: string | null
          revoked_at: string | null
          token: string
          used_at: string | null
          used_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "platform_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_remove_workspace_member: {
        Args: { p_user_id: string; p_workspace_id: string }
        Returns: undefined
      }
      admin_revoke_platform_invite: {
        Args: { p_invite_id: string }
        Returns: undefined
      }
      admin_set_member_role: {
        Args: {
          p_role: Database["public"]["Enums"]["workspace_role"]
          p_user_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      admin_set_workspace_limits: {
        Args: { p_limits: Json; p_note: string; p_workspace_id: string }
        Returns: undefined
      }
      admin_update_privacy_notice: {
        Args: { p_markdown: string }
        Returns: undefined
      }
      admin_workspace_stats: {
        Args: Record<PropertyKey, never>
        Returns: {
          member_count: number
          owner_id: string
          response_count: number
          storage_bytes_used: number
          survey_count: number
          workspace_id: string
        }[]
      }
      answer_has_value: { Args: { p_row: Json }; Returns: boolean }
      answer_row: {
        Args: { p_config: Json; p_options: Json; p_type: string; p_value: Json }
        Returns: Json
      }
      apply_invites: {
        Args: {
          p_email: string
          p_platform_token: string
          p_user_id: string
          p_workspace_token: string
        }
        Returns: Json
      }
      archive_workspace: {
        Args: { p_workspace_id: string }
        Returns: undefined
      }
      assignable_member_role: {
        Args: { p_role: Database["public"]["Enums"]["workspace_role"] }
        Returns: Database["public"]["Enums"]["workspace_role"]
      }
      caller_role: {
        Args: { p_workspace_id: string }
        Returns: Database["public"]["Enums"]["workspace_role"]
      }
      claim_pending_invite: { Args: Record<PropertyKey, never>; Returns: Json }
      claim_platform_invite: { Args: { p_token: string }; Returns: Json }
      complete_storage_deletions: {
        Args: { p_done: number[]; p_failed?: Json }
        Returns: undefined
      }
      contact_duplicate_candidates: {
        Args: { p_workspace_id: string }
        Returns: {
          contact_a: string
          contact_b: string
          reason: string
        }[]
      }
      contact_family: { Args: { p_contact_id: string }; Returns: string[] }
      create_builtin_contact_views: {
        Args: { p_workspace_id: string }
        Returns: undefined
      }
      create_survey: {
        Args: {
          p_template_id?: string
          p_title: string
          p_workspace_id: string
        }
        Returns: string
      }
      create_upload: { Args: { p_payload: Json }; Returns: Json }
      definition_question_count: {
        Args: { p_definition: Json }
        Returns: number
      }
      definition_questions: {
        Args: { p_definition: Json }
        Returns: {
          page_id: string
          page_index: number
          position: number
          q: Json
          question_id: string
          question_key: string
        }[]
      }
      delete_response: { Args: { p_response_id: string }; Returns: undefined }
      delete_survey: { Args: { p_survey_id: string }; Returns: undefined }
      delete_workspace_image: {
        Args: { p_image_id: string }
        Returns: undefined
      }
      directory_profiles: {
        Args: Record<PropertyKey, never>
        Returns: {
          avatar_url: string
          display_name: string
          id: string
        }[]
      }
      effective_limits: {
        Args: { p_workspace_id: string }
        Returns: {
          max_definition_bytes: number
          max_file_bytes: number
          max_files_per_response: number
          max_questions: number
          rate_limit_per_hour: number
          raw_script_pixels_allowed: boolean
        }[]
      }
      empty_survey_definition: {
        Args: { p_theme: Json; p_title: string }
        Returns: Json
      }
      erase_respondent: {
        Args: { p_contact_id: string; p_mode: string }
        Returns: {
          bucket: string
          deletion_id: number
          path: string
        }[]
      }
      erasure_email_hash: { Args: { p_email: string }; Returns: string }
      export_respondent_data: { Args: { p_contact_id: string }; Returns: Json }
      filtered_responses: {
        Args: { p_filters?: Json; p_survey_id: string }
        Returns: {
          anonymized_at: string | null
          contact_id: string | null
          id: string
          identity_source: string | null
          ip: unknown
          last_question_key: string | null
          metadata: NonNullable<Json>
          raw: NonNullable<Json>
          respondent_hash: string | null
          respondent_token_id: string | null
          resume_token_hash: string | null
          score: number | null
          score_max: number | null
          started_at: string
          status: Database["public"]["Enums"]["response_status"]
          submitted_at: string | null
          survey_id: string
          survey_version_id: string
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "responses"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      find_or_create_contact_by_email: {
        Args: { p_email: string; p_source: string; p_workspace_id: string }
        Returns: string
      }
      finish_import: {
        Args: { p_import_id: string; p_summary: Json }
        Returns: undefined
      }
      flag_on: { Args: { p_name: string }; Returns: boolean }
      follow_contact: { Args: { p_contact_id: string }; Returns: string }
      gen_survey_slug: { Args: Record<PropertyKey, never>; Returns: string }
      gen_token: { Args: { n: number }; Returns: string }
      get_public_definition: {
        Args: { p_key: string; p_version_id: string }
        Returns: {
          public_definition: Json
          version_id: string
          version_no: number
        }[]
      }
      hash_share_password: { Args: { p_password: string }; Returns: string }
      image_for_write: {
        Args: { p_image_id: string }
        Returns: {
          bytes: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          height: number | null
          id: string
          kind: string
          label: string
          mime: string
          path: string
          source: string
          width: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_images"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      import_contacts_chunk: {
        Args: { p_import_id: string; p_rows: Json }
        Returns: Json
      }
      insert_member_direct: {
        Args: {
          p_role: Database["public"]["Enums"]["workspace_role"]
          p_user_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      invite_preview: {
        Args: { p_token: string }
        Returns: {
          logo_path: string
          role: Database["public"]["Enums"]["workspace_role"]
          workspace_name: string
        }[]
      }
      is_active_member: {
        Args: { p_user: string; p_workspace_id: string }
        Returns: boolean
      }
      is_active_profile: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_member: {
        Args: {
          p_min_role?: Database["public"]["Enums"]["workspace_role"]
          p_workspace_id: string
        }
        Returns: boolean
      }
      is_platform_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_secret_column: { Args: { p_name: string }; Returns: boolean }
      is_service_role: { Args: Record<PropertyKey, never>; Returns: boolean }
      is_trusted_caller: { Args: Record<PropertyKey, never>; Returns: boolean }
      jsonb_find_key: {
        Args: { p_doc: Json; p_keys: string[] }
        Returns: string
      }
      list_workspace_images: {
        Args: { p_workspace_id: string }
        Returns: {
          bytes: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          height: number | null
          id: string
          kind: string
          label: string
          mime: string
          path: string
          source: string
          width: number | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "workspace_images"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      log_export: {
        Args: {
          p_kind: string
          p_row_count: number
          p_scope: Json
          p_workspace_id: string
        }
        Returns: undefined
      }
      member_owned_survey_counts: {
        Args: { p_workspace_id: string }
        Returns: {
          owned_surveys: number
          user_id: string
        }[]
      }
      merge_contacts: {
        Args: { p_field_choices?: Json; p_merged: string[]; p_survivor: string }
        Returns: undefined
      }
      multi_choice_ids: { Args: { p_json: Json }; Returns: Json }
      pending_storage_deletions: {
        Args: { p_workspace_id: string }
        Returns: {
          bucket: string
          deletion_id: number
          path: string
        }[]
      }
      platform_storage_usage: {
        Args: Record<PropertyKey, never>
        Returns: {
          bytes: number
          name: string
          slug: string
          workspace_id: string
        }[]
      }
      publish_survey_version: {
        Args: {
          p_expected_revision: number
          p_public_definition: Json
          p_version_id: string
        }
        Returns: string
      }
      purge_workspace: { Args: { p_workspace_id: string }; Returns: Json }
      question_storage_column: { Args: { p_type: string }; Returns: string }
      rate_limit_hit: {
        Args: {
          p_bucket: string
          p_key: string
          p_max: number
          p_window: string
        }
        Returns: boolean
      }
      reconcile_storage_bytes: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      record_events: { Args: { p_events: Json }; Returns: number }
      register_workspace_image: {
        Args: {
          p_bytes: number
          p_height?: number
          p_id: string
          p_kind: string
          p_label?: string
          p_mime: string
          p_path: string
          p_width?: number
          p_workspace_id: string
        }
        Returns: {
          bytes: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          height: number | null
          id: string
          kind: string
          label: string
          mime: string
          path: string
          source: string
          width: number | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_images"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_draft_lock: { Args: { p_version_id: string }; Returns: undefined }
      remove_survey_collaborator: {
        Args: { p_survey_id: string; p_user_id: string }
        Returns: undefined
      }
      rename_workspace_slug: {
        Args: { p_slug: string; p_workspace_id: string }
        Returns: undefined
      }
      report_share_gate: {
        Args: { p_password?: string; p_token: string }
        Returns: {
          report_id: string
          status: string
        }[]
      }
      report_widget_data: {
        Args: {
          p_filters: Json
          p_metric: string
          p_question_key: string
          p_survey_id: string
        }
        Returns: Json
      }
      request_workspace_deletion: {
        Args: { p_confirm_slug: string; p_workspace_id: string }
        Returns: undefined
      }
      reserved_public_segments: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      resolve_public_survey: {
        Args: { p_key: string }
        Returns: {
          alias: string
          allow_indexing: boolean
          closed_message: string
          closes_at: string
          effective_state: string
          logo_path: string
          matched_by: string
          og_description: string
          og_image_path: string
          og_title: string
          opens_at: string
          pixel_consent_mode: Database["public"]["Enums"]["pixel_consent_mode"]
          pixels: Json
          privacy_notice_url: string
          show_powered_by: boolean
          slug: string
          state_reason: string
          survey_id: string
          title: string
          version_id: string
          version_no: number
          workspace_id: string
          workspace_name: string
        }[]
      }
      restore_workspace: {
        Args: { p_workspace_id: string }
        Returns: undefined
      }
      retention_batch: {
        Args: { p_limit?: number; p_workspace_id: string }
        Returns: {
          bucket: string
          deletion_id: number
          path: string
        }[]
      }
      richtext_plain: { Args: { p: Json }; Returns: string }
      rollup_old_events: {
        Args: Record<PropertyKey, never>
        Returns: undefined
      }
      sanitize_response_metadata: { Args: { p_meta: Json }; Returns: Json }
      save_draft: {
        Args: {
          p_definition: Json
          p_expected_revision: number
          p_version_id: string
        }
        Returns: number
      }
      search_contacts: {
        Args: {
          p_cursor?: Json
          p_filters?: Json
          p_limit?: number
          p_workspace_id: string
        }
        Returns: {
          company: string | null
          created_at: string
          created_by: string | null
          custom: NonNullable<Json>
          deleted_at: string | null
          email: string | null
          first_name: string | null
          follow_up_at: string | null
          follow_up_note: string | null
          id: string
          last_name: string | null
          last_response_at: string | null
          lead_status: Database["public"]["Enums"]["lead_status"]
          lead_status_changed_at: string | null
          merged_at: string | null
          merged_into: string | null
          owner_id: string | null
          phone: string | null
          response_count: number
          source: string | null
          status: string
          tags: string[]
          updated_at: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "contacts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      server_only_keys: { Args: Record<PropertyKey, never>; Returns: string[] }
      set_contact_custom: {
        Args: { p_contact_id: string; p_values: Json }
        Returns: Json
      }
      set_survey_alias: {
        Args: { p_alias: string; p_survey_id: string }
        Returns: undefined
      }
      set_survey_owner: {
        Args: { p_survey_id: string; p_user_id: string }
        Returns: undefined
      }
      set_workspace_image_label: {
        Args: { p_image_id: string; p_label: string }
        Returns: undefined
      }
      sha256_hex: { Args: { p_text: string }; Returns: string }
      shared_report_payload: {
        Args: { p_password: string; p_token: string }
        Returns: Json
      }
      shares_workspace: { Args: { p_user: string }; Returns: boolean }
      signup_verified_email: { Args: { p_user_id: string }; Returns: string }
      snapshot_labels: { Args: { p_items: Json }; Returns: Json }
      storage_object_name: {
        Args: { p_bucket: string; p_path: string }
        Returns: string
      }
      storage_sweep_batch: {
        Args: { p_limit?: number }
        Returns: {
          bucket: string
          deletion_id: number
          path: string
        }[]
      }
      storage_workspace_id: { Args: { p_name: string }; Returns: string }
      submit_response: { Args: { p_payload: Json }; Returns: Json }
      submit_response_core: {
        Args: { p_action: string; p_payload: Json }
        Returns: Json
      }
      survey_effective_state: {
        Args: {
          p_workspace_archived?: boolean
          s: Omit<
            Database["public"]["Tables"]["surveys"]["Row"],
            Database["public"]["Tables"]["surveys"]["ComputedFields"]
          >
        }
        Returns: {
          reason: string
          state: string
        }[]
      }
      survey_for_assignment: { Args: { p_survey_id: string }; Returns: string }
      take_draft_lock: {
        Args: { p_force?: boolean; p_version_id: string }
        Returns: Json
      }
      transfer_workspace_ownership: {
        Args: { p_new_owner: string; p_workspace_id: string }
        Returns: undefined
      }
      unarchive_workspace: {
        Args: { p_workspace_id: string }
        Returns: undefined
      }
      upload_mime_allowed: { Args: { p_mime: string }; Returns: boolean }
      validate_contact_custom: {
        Args: { p_custom: Json; p_workspace_id: string }
        Returns: Json
      }
      validate_survey_definition: {
        Args: { p_definition: Json; p_workspace_id: string }
        Returns: undefined
      }
      version_questions: {
        Args: { p_version_id: string }
        Returns: {
          config: NonNullable<Json>
          id: string
          is_pii: boolean
          label: string
          label_hash: string
          options: Json | null
          page_index: number
          position: number
          question_key: string
          required: boolean
          survey_id: string
          survey_version_id: string
          type: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "questions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      workspace_members_with_email: {
        Args: { p_workspace_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          email: string
          invite_id: string
          joined_at: string
          role: Database["public"]["Enums"]["workspace_role"]
          status: Database["public"]["Enums"]["profile_status"]
          user_id: string
        }[]
      }
      workspace_purge_due: { Args: { p_limit?: number }; Returns: string[] }
      workspace_slug_available: {
        Args: { p_slug: string; p_workspace_id?: string }
        Returns: boolean
      }
      write_activity: {
        Args: {
          p_action: string
          p_diff?: Json
          p_entity: string
          p_entity_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      write_platform_audit: {
        Args: {
          p_action: string
          p_details?: Json
          p_target_id: string
          p_target_type: string
        }
        Returns: undefined
      }
    }
    Enums: {
      lead_status: "new" | "contacted" | "qualified" | "customer" | "lost"
      pixel_consent_mode: "banner" | "notice" | "in_form"
      pixel_type: "ga4" | "meta" | "gtm" | "custom_script"
      profile_status: "pending" | "active" | "disabled" | "deleted"
      response_status: "partial" | "complete"
      survey_state: "draft" | "open" | "closed" | "scheduled"
      version_status: "draft" | "published"
      workspace_role: "viewer" | "editor" | "admin" | "owner"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      lead_status: ["new", "contacted", "qualified", "customer", "lost"],
      pixel_consent_mode: ["banner", "notice", "in_form"],
      pixel_type: ["ga4", "meta", "gtm", "custom_script"],
      profile_status: ["pending", "active", "disabled", "deleted"],
      response_status: ["partial", "complete"],
      survey_state: ["draft", "open", "closed", "scheduled"],
      version_status: ["draft", "published"],
      workspace_role: ["viewer", "editor", "admin", "owner"],
    },
  },
} as const
