import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/types';

/** No division matches this, so a query filtered on it comes back empty. */
export const NOBODY = '00000000-0000-0000-0000-000000000000';

export type Viewing = {
  leagueId: string;
  leagueName: string;
  isOwner: boolean;
  /** Your own division — null when you're watching rather than playing. */
  divisionId: string | null;
  divisionName: string | null;
  /**
   * Any division in the group, used to work out which gameweek is running.
   * Every division in a group drafts the same one, so for a viewer with no
   * division of their own this is as good an anchor as any.
   */
  anchorDivisionId: string;
  viewer: boolean;
  /** The group is still playing elsewhere: history here, no drafting yet. */
  paused: boolean;
};

const one = <T,>(v: T | T[]): T => (Array.isArray(v) ? v[0] : v);

/**
 * What this player's relationship to a group is, if any.
 *
 * Playing is checked first and wins: somebody who drafts in a group is not
 * a viewer of it, whatever their membership row happens to say.
 */
export async function viewingFor(
  supabase: SupabaseClient<Database>,
  userId: string,
  seasonId: string,
): Promise<Viewing | null> {
  const { data: playing } = await supabase
    .from('division_members')
    .select(
      'division_id, league_id, divisions(id, name, tier), leagues(name, owner_id, drafting_paused)',
    )
    .eq('user_id', userId)
    .eq('season_id', seasonId)
    .maybeSingle();

  if (playing) {
    const league = one(playing.leagues) as {
      name: string;
      owner_id: string;
      drafting_paused?: boolean;
    } | null;
    const division = one(playing.divisions) as { name: string } | null;
    return {
      leagueId: playing.league_id,
      leagueName: league?.name ?? 'Your group',
      isOwner: league?.owner_id === userId,
      divisionId: playing.division_id,
      divisionName: division?.name ?? null,
      anchorDivisionId: playing.division_id,
      viewer: false,
      paused: league?.drafting_paused ?? false,
    };
  }

  const { data: watching } = await supabase
    .from('league_members')
    .select('league_id, role, leagues(name, owner_id, drafting_paused)')
    .eq('user_id', userId)
    .eq('role', 'viewer')
    .maybeSingle();

  if (!watching) return null;

  const league = one(watching.leagues) as {
    name: string;
    owner_id: string;
    drafting_paused?: boolean;
  } | null;

  // Lowest tier first, so the anchor is stable as divisions come and go.
  const { data: anchor } = await supabase
    .from('divisions')
    .select('id')
    .eq('league_id', watching.league_id)
    .eq('season_id', seasonId)
    .order('tier')
    .limit(1)
    .maybeSingle();

  return {
    leagueId: watching.league_id,
    leagueName: league?.name ?? 'The group',
    isOwner: league?.owner_id === userId,
    divisionId: null,
    divisionName: null,
    anchorDivisionId: anchor?.id ?? NOBODY,
    viewer: true,
    paused: league?.drafting_paused ?? false,
  };
}
