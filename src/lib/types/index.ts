/**
 * Friendly aliases over the generated Supabase types.
 *
 * `database.ts` is machine-generated and gets overwritten wholesale by
 * `supabase gen types`. Import from *this* file instead, so regenerating the
 * schema never breaks call sites.
 */
import type { Database } from './database';

export type { Database };

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T];

// ---- Enums ----
export type Outcome = Enums<'outcome'>;
export type GameweekStatus = Enums<'gameweek_status'>;
export type FixtureStatus = Enums<'fixture_status'>;
export type DraftStatus = Enums<'draft_status'>;

// ---- Rows ----
export type Profile = Tables<'profiles'>;
export type Season = Tables<'seasons'>;
export type Competition = Tables<'competitions'>;
export type Team = Tables<'teams'>;
export type Gameweek = Tables<'gameweeks'>;
export type Fixture = Tables<'fixtures'>;
export type League = Tables<'leagues'>;
export type LeagueMember = Tables<'league_members'>;
export type Division = Tables<'divisions'>;
export type DivisionMember = Tables<'division_members'>;
export type Draft = Tables<'drafts'>;
export type GameweekScore = Tables<'gameweek_scores'>;

/**
 * Deliberately not called `Pick` — that would shadow TypeScript's built-in
 * `Pick<T, K>` utility in every file that imports it.
 */
export type DraftPick = Tables<'picks'>;
