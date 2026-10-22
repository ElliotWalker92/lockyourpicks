import type { SupabaseClient } from '@supabase/supabase-js';

import { callRpc } from '@/lib/supabase/rpc';
import type { Database } from '@/lib/types';

type Client = SupabaseClient<Database>;
type CompetitionRow = Database['public']['Tables']['competitions']['Row'];

export type Competition = {
  id: string;
  code: string;
  name: string;
  tier: number | null;
  is_cup: boolean;
  is_core: boolean;
};

/**
 * Which competitions a league draws its fixtures from.
 *
 * The English core is seeded into every league by a trigger and cannot be
 * removed (migration 0042), so this is never empty for a real league — but
 * it is returned as a list rather than assumed, because the whole point of
 * the table is that two leagues can answer differently.
 *
 * Callers use it to narrow fixture queries. That narrowing is presentation
 * only: `make_pick` and `auto_pick` check the same table themselves, since a
 * fixture id arrives from the client and a filter in a page is a suggestion.
 */
export async function leagueCompetitionIds(
  supabase: Client,
  leagueId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('league_competitions')
    .select('competition_id')
    .eq('league_id', leagueId);

  // An empty answer is never correct for a real league — the trigger seeds
  // the core — so it means the read failed or the migration isn't applied.
  // Callers fail open on an empty list rather than filtering every fixture
  // off the board, which is why this logs instead of staying quiet.
  if (error) console.error(`league competitions (${leagueId}):`, error.message);
  return (data ?? []).map((r) => r.competition_id);
}

/**
 * Everything on offer, core first.
 *
 * `is_active` is the global switch — whether we are willing to offer a
 * competition at all — and is separate from whether any given league has
 * turned it on. The admin screens show this list; the per-league choice is
 * made against it.
 *
 * Excludes the ones we follow only to rate their clubs. They are fetched and
 * replayed and nobody plays them, so offering them would be offering
 * something the database will refuse — see migration 0049.
 */
export async function competitionsOnOffer(
  supabase: Client,
): Promise<Competition[]> {
  const { data } = await supabase
    .from('competitions')
    .select('id, code, name, tier, is_cup, is_core')
    .eq('is_active', true)
    .eq('ratings_only', false)
    .order('is_core', { ascending: false })
    .order('tier', { ascending: true, nullsFirst: false })
    .order('code');
  return (data ?? []) as Competition[];
}

/**
 * The competitions worth spending provider calls on.
 *
 * Active, and either core or turned on by at least one league. A competition
 * nobody has opted into buys fixtures no board will ever show, and the
 * provider's per-minute ceiling — enforced per IP, shared across Workers —
 * is the scarcest thing this app has.
 *
 * The rule lives in `competitions_in_play()` rather than here, so the jobs
 * and the database agree on it by construction.
 */
export async function competitionsInPlay(
  supabase: Client,
): Promise<CompetitionRow[]> {
  const { data, error } = await callRpc<CompetitionRow[]>(
    supabase,
    'competitions_in_play',
  );
  if (error) throw new Error(`competitions in play: ${error.message}`);
  return data ?? [];
}
