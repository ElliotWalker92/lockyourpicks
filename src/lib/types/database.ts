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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      competitions: {
        Row: {
          code: string
          id: string
          is_active: boolean
          is_cup: boolean
          name: string
          provider_league_id: number | null
          tier: number | null
        }
        Insert: {
          code: string
          id?: string
          is_active?: boolean
          is_cup?: boolean
          name: string
          provider_league_id?: number | null
          tier?: number | null
        }
        Update: {
          code?: string
          id?: string
          is_active?: boolean
          is_cup?: boolean
          name?: string
          provider_league_id?: number | null
          tier?: number | null
        }
        Relationships: []
      }
      division_members: {
        Row: {
          division_id: string
          league_id: string
          user_id: string
        }
        Insert: {
          division_id: string
          league_id: string
          user_id: string
        }
        Update: {
          division_id?: string
          league_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "division_members_division_id_fkey"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "division_members_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      divisions: {
        Row: {
          created_at: string
          id: string
          league_id: string
          name: string
          tier: number
        }
        Insert: {
          created_at?: string
          id?: string
          league_id: string
          name: string
          tier: number
        }
        Update: {
          created_at?: string
          id?: string
          league_id?: string
          name?: string
          tier?: number
        }
        Relationships: [
          {
            foreignKeyName: "divisions_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      drafts: {
        Row: {
          completed_at: string | null
          current_turn: number
          division_id: string
          gameweek_id: string
          id: string
          pick_order: string[]
          picks_per_player: number
          status: Database["public"]["Enums"]["draft_status"]
          turn_expires_at: string | null
          turn_started_at: string | null
        }
        Insert: {
          completed_at?: string | null
          current_turn?: number
          division_id: string
          gameweek_id: string
          id?: string
          pick_order: string[]
          picks_per_player?: number
          status?: Database["public"]["Enums"]["draft_status"]
          turn_expires_at?: string | null
          turn_started_at?: string | null
        }
        Update: {
          completed_at?: string | null
          current_turn?: number
          division_id?: string
          gameweek_id?: string
          id?: string
          pick_order?: string[]
          picks_per_player?: number
          status?: Database["public"]["Enums"]["draft_status"]
          turn_expires_at?: string | null
          turn_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drafts_division_id_fkey"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drafts_gameweek_id_fkey"
            columns: ["gameweek_id"]
            isOneToOne: false
            referencedRelation: "gameweeks"
            referencedColumns: ["id"]
          },
        ]
      }
      fixtures: {
        Row: {
          away_score: number | null
          away_team_id: string
          competition_id: string
          gameweek_id: string
          home_score: number | null
          home_team_id: string
          id: string
          kickoff_at: string
          provider_fixture_id: number | null
          result: Database["public"]["Enums"]["outcome"] | null
          status: Database["public"]["Enums"]["fixture_status"]
          updated_at: string
        }
        Insert: {
          away_score?: number | null
          away_team_id: string
          competition_id: string
          gameweek_id: string
          home_score?: number | null
          home_team_id: string
          id?: string
          kickoff_at: string
          provider_fixture_id?: number | null
          result?: Database["public"]["Enums"]["outcome"] | null
          status?: Database["public"]["Enums"]["fixture_status"]
          updated_at?: string
        }
        Update: {
          away_score?: number | null
          away_team_id?: string
          competition_id?: string
          gameweek_id?: string
          home_score?: number | null
          home_team_id?: string
          id?: string
          kickoff_at?: string
          provider_fixture_id?: number | null
          result?: Database["public"]["Enums"]["outcome"] | null
          status?: Database["public"]["Enums"]["fixture_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixtures_away_team_id_fkey"
            columns: ["away_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_gameweek_id_fkey"
            columns: ["gameweek_id"]
            isOneToOne: false
            referencedRelation: "gameweeks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixtures_home_team_id_fkey"
            columns: ["home_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      gameweek_scores: {
        Row: {
          correct_count: number
          division_id: string
          gameweek_id: string
          points: number
          settled_at: string
          user_id: string
        }
        Insert: {
          correct_count?: number
          division_id: string
          gameweek_id: string
          points?: number
          settled_at?: string
          user_id: string
        }
        Update: {
          correct_count?: number
          division_id?: string
          gameweek_id?: string
          points?: number
          settled_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gameweek_scores_division_id_fkey"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gameweek_scores_gameweek_id_fkey"
            columns: ["gameweek_id"]
            isOneToOne: false
            referencedRelation: "gameweeks"
            referencedColumns: ["id"]
          },
        ]
      }
      gameweeks: {
        Row: {
          draft_closes_at: string
          draft_opens_at: string
          first_kickoff_at: string | null
          id: string
          name: string | null
          number: number
          season_id: string
          status: Database["public"]["Enums"]["gameweek_status"]
        }
        Insert: {
          draft_closes_at: string
          draft_opens_at: string
          first_kickoff_at?: string | null
          id?: string
          name?: string | null
          number: number
          season_id: string
          status?: Database["public"]["Enums"]["gameweek_status"]
        }
        Update: {
          draft_closes_at?: string
          draft_opens_at?: string
          first_kickoff_at?: string | null
          id?: string
          name?: string | null
          number?: number
          season_id?: string
          status?: Database["public"]["Enums"]["gameweek_status"]
        }
        Relationships: [
          {
            foreignKeyName: "gameweeks_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      league_members: {
        Row: {
          joined_at: string
          league_id: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          league_id: string
          user_id: string
        }
        Update: {
          joined_at?: string
          league_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "league_members_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          created_at: string
          division_size: number
          id: string
          join_code: string
          name: string
          owner_id: string
          season_id: string
        }
        Insert: {
          created_at?: string
          division_size?: number
          id?: string
          join_code: string
          name: string
          owner_id: string
          season_id: string
        }
        Update: {
          created_at?: string
          division_size?: number
          id?: string
          join_code?: string
          name?: string
          owner_id?: string
          season_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leagues_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      picks: {
        Row: {
          created_at: string
          draft_id: string
          fixture_id: string
          id: string
          is_auto_pick: boolean
          pick_number: number
          points_awarded: number | null
          predicted_outcome: Database["public"]["Enums"]["outcome"]
          user_id: string
        }
        Insert: {
          created_at?: string
          draft_id: string
          fixture_id: string
          id?: string
          is_auto_pick?: boolean
          pick_number: number
          points_awarded?: number | null
          predicted_outcome: Database["public"]["Enums"]["outcome"]
          user_id: string
        }
        Update: {
          created_at?: string
          draft_id?: string
          fixture_id?: string
          id?: string
          is_auto_pick?: boolean
          pick_number?: number
          points_awarded?: number | null
          predicted_outcome?: Database["public"]["Enums"]["outcome"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "picks_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_color: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          is_admin: boolean
          updated_at: string
        }
        Insert: {
          avatar_color?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          is_admin?: boolean
          updated_at?: string
        }
        Update: {
          avatar_color?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          is_admin?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      seasons: {
        Row: {
          ends_on: string
          id: string
          is_active: boolean
          name: string
          starts_on: string
        }
        Insert: {
          ends_on: string
          id?: string
          is_active?: boolean
          name: string
          starts_on: string
        }
        Update: {
          ends_on?: string
          id?: string
          is_active?: boolean
          name?: string
          starts_on?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          crest_url: string | null
          elo_rating: number
          elo_updated_at: string | null
          id: string
          name: string
          provider_team_id: number | null
          short_name: string | null
        }
        Insert: {
          crest_url?: string | null
          elo_rating?: number
          elo_updated_at?: string | null
          id?: string
          name: string
          provider_team_id?: number | null
          short_name?: string | null
        }
        Update: {
          crest_url?: string | null
          elo_rating?: number
          elo_updated_at?: string | null
          id?: string
          name?: string
          provider_team_id?: number | null
          short_name?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_draft_turn: { Args: { p_draft_id: string }; Returns: undefined }
      auto_pick: {
        Args: { p_draft_id: string }
        Returns: {
          created_at: string
          draft_id: string
          fixture_id: string
          id: string
          is_auto_pick: boolean
          pick_number: number
          points_awarded: number | null
          predicted_outcome: Database["public"]["Enums"]["outcome"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "picks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      draft_user_at_turn: {
        Args: { p_order: string[]; p_turn: number }
        Returns: string
      }
      is_admin: { Args: never; Returns: boolean }
      make_pick: {
        Args: {
          p_draft_id: string
          p_fixture_id: string
          p_outcome: Database["public"]["Enums"]["outcome"]
        }
        Returns: {
          created_at: string
          draft_id: string
          fixture_id: string
          id: string
          is_auto_pick: boolean
          pick_number: number
          points_awarded: number | null
          predicted_outcome: Database["public"]["Enums"]["outcome"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "picks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      run_expired_turns: { Args: never; Returns: number }
      set_admin_by_email: { Args: { p_email: string }; Returns: undefined }
      settle_gameweek: { Args: { p_gameweek_id: string }; Returns: number }
      shares_league_with_division: {
        Args: { p_division_id: string }
        Returns: boolean
      }
      start_drafts_for_gameweek: {
        Args: { p_gameweek_id: string }
        Returns: number
      }
    }
    Enums: {
      draft_status: "pending" | "active" | "complete"
      fixture_status:
        | "scheduled"
        | "live"
        | "finished"
        | "postponed"
        | "cancelled"
      gameweek_status: "upcoming" | "drafting" | "locked" | "live" | "settled"
      outcome: "HOME" | "DRAW" | "AWAY"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      draft_status: ["pending", "active", "complete"],
      fixture_status: [
        "scheduled",
        "live",
        "finished",
        "postponed",
        "cancelled",
      ],
      gameweek_status: ["upcoming", "drafting", "locked", "live", "settled"],
      outcome: ["HOME", "DRAW", "AWAY"],
    },
  },
} as const
