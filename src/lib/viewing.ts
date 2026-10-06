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
  /** What the membership row says, as opposed to whether you have a division. */
  role: 'player' | 'viewer';
};

const one = <T,>(v: T | T[]): T => (Array.isArray(v) ? v[0] : v);

type LeagueRow = {
  name: string;
  owner_id: string | null;
  drafting_paused?: boolean;
} | null;

/**
 * Every group this player belongs to, playing or watching.
 *
 * Both halves matter and neither is sufficient on its own. A division
 * membership is the strong signal — it means you draft — but a group whose
 * divisions haven't been drawn up yet has players and no division rows at
 * all, and those people were invisible to the app entirely: it looked only
 * for a division, then only for a viewer row, and a player awaiting a
 * division was neither.
 *
 * Both queries used to end in `.maybeSingle()`, which is an error rather
 * than a choice when there are two rows. Anyone in a second group had their
 * first one silently fail and fall through to whichever the next query
 * found.
 *
 * Playing first, then alphabetical, so the order is stable between loads —
 * a switcher that reshuffles itself is worse than no switcher.
 */
export async function membershipsFor(
  supabase: SupabaseClient<Database>,
  userId: string,
  seasonId: string,
): Promise<Viewing[]> {
  const [{ data: playingRows }, { data: memberRows }] = await Promise.all([
    supabase
      .from('division_members')
      .select(
        'division_id, league_id, divisions(id, name, tier), leagues(name, owner_id, drafting_paused)',
      )
      .eq('user_id', userId)
      .eq('season_id', seasonId),
    supabase
      .from('league_members')
      .select('league_id, role, leagues(name, owner_id, drafting_paused)')
      .eq('user_id', userId),
  ]);

  const playing = playingRows ?? [];
  const members = memberRows ?? [];

  const roleOf = new Map(
    members.map((m) => [m.league_id, (m.role ?? 'player') as 'player' | 'viewer']),
  );

  const byLeague = new Map<string, Viewing>();

  for (const row of playing) {
    const league = one(row.leagues) as LeagueRow;
    const division = one(row.divisions) as { name: string } | null;
    byLeague.set(row.league_id, {
      leagueId: row.league_id,
      leagueName: league?.name ?? 'Your group',
      isOwner: league?.owner_id === userId,
      divisionId: row.division_id,
      divisionName: division?.name ?? null,
      anchorDivisionId: row.division_id,
      viewer: false,
      paused: league?.drafting_paused ?? false,
      role: roleOf.get(row.league_id) ?? 'player',
    });
  }

  // Groups they belong to without a division of their own: watchers, and
  // players in a group whose divisions haven't been drawn up yet.
  const without = members.filter((m) => !byLeague.has(m.league_id));

  if (without.length > 0) {
    // Lowest tier first, so the anchor is stable as divisions come and go.
    const { data: anchorRows } = await supabase
      .from('divisions')
      .select('id, league_id, tier')
      .in(
        'league_id',
        without.map((m) => m.league_id),
      )
      .eq('season_id', seasonId)
      .order('tier');

    const anchorOf = new Map<string, string>();
    for (const d of anchorRows ?? []) {
      if (!anchorOf.has(d.league_id)) anchorOf.set(d.league_id, d.id);
    }

    for (const m of without) {
      const league = one(m.leagues) as LeagueRow;
      byLeague.set(m.league_id, {
        leagueId: m.league_id,
        leagueName: league?.name ?? 'The group',
        isOwner: league?.owner_id === userId,
        divisionId: null,
        divisionName: null,
        // A group with no divisions yet has no anchor; the pages that use it
        // come back empty, which is the truth about a group not yet running.
        anchorDivisionId: anchorOf.get(m.league_id) ?? NOBODY,
        viewer: true,
        paused: league?.drafting_paused ?? false,
        role: (m.role ?? 'player') as 'player' | 'viewer',
      });
    }
  }

  return [...byLeague.values()].sort(
    (a, b) =>
      Number(a.viewer) - Number(b.viewer) ||
      a.leagueName.localeCompare(b.leagueName),
  );
}

/**
 * The group being looked at.
 *
 * `preferred` is whichever one they last switched to. It is checked against
 * their actual memberships rather than trusted, so a stale or hand-edited
 * cookie falls back to the first group instead of showing somebody else's.
 */
export async function viewingFor(
  supabase: SupabaseClient<Database>,
  userId: string,
  seasonId: string,
  preferred?: string | null,
): Promise<Viewing | null> {
  const all = await membershipsFor(supabase, userId, seasonId);
  if (all.length === 0) return null;
  return all.find((v) => v.leagueId === preferred) ?? all[0];
}
