'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';

export type DivisionSetup = {
  id: string;
  name: string;
  tier: number;
  /** Player ids in running order — index 0 starts gameweek 1. */
  members: string[];
};

export type SetupState = { error: string | null; success: string | null };

/**
 * Save the owner's arrangement: division names, who is in each, and the
 * running order within each.
 *
 * Applied as a whole rather than as individual moves. Dragging one player
 * between divisions leaves a gap and an overflow simultaneously, so a
 * partially-applied arrangement is always invalid — validate the finished
 * shape, then write it.
 *
 * Existing drafts are untouched: `pick_order` is copied into the draft when
 * it opens, so a reshuffle affects the next gameweek rather than rewriting
 * one already in progress.
 */
export async function saveDivisionSetup(
  leagueId: string,
  divisions: DivisionSetup[],
): Promise<SetupState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You need to be signed in.', success: null };

  const { data: league } = await supabase
    .from('leagues')
    .select('id, owner_id, division_size')
    .eq('id', leagueId)
    .single();

  if (!league) return { error: 'League not found.', success: null };
  if (league.owner_id !== user.id) {
    return { error: 'Only the league owner can arrange divisions.', success: null };
  }

  const { data: season } = await supabase
    .from('seasons')
    .select('id')
    .eq('is_active', true)
    .maybeSingle();
  if (!season) return { error: 'No active season.', success: null };

  const { data: members } = await supabase
    .from('league_members')
    .select('user_id')
    .eq('league_id', leagueId);
  const leagueIds = new Set((members ?? []).map((m) => m.user_id));

  // ---- Validate the whole arrangement before writing any of it ----
  const seen = new Set<string>();
  for (const d of divisions) {
    if (!d.name.trim()) {
      return { error: 'Every division needs a name.', success: null };
    }
    if (d.name.length > 40) {
      return { error: 'Division names must be under 40 characters.', success: null };
    }
    for (const id of d.members) {
      if (!leagueIds.has(id)) {
        return { error: 'Someone in that arrangement isn’t in this league.', success: null };
      }
      if (seen.has(id)) {
        return { error: 'A player can only be in one division.', success: null };
      }
      seen.add(id);
    }
  }

  const unplaced = [...leagueIds].filter((id) => !seen.has(id));
  if (unplaced.length > 0) {
    return {
      error: `${unplaced.length} player${unplaced.length === 1 ? ' is' : 's are'} not in a division yet.`,
      success: null,
    };
  }

  // A division of one has nobody to draft against; a division bigger than the
  // league's size runs out of fixtures on thin weeks.
  for (const d of divisions) {
    if (d.members.length < 2) {
      return {
        error: `${d.name} has ${d.members.length} player${d.members.length === 1 ? '' : 's'} — a division needs at least 2.`,
        success: null,
      };
    }
    if (d.members.length > league.division_size) {
      return {
        error: `${d.name} has ${d.members.length} players, more than the league's ${league.division_size} per division.`,
        success: null,
      };
    }
  }

  // ---- Write ----
  for (const d of divisions) {
    const { error } = await supabase
      .from('divisions')
      .update({ name: d.name.trim(), tier: d.tier })
      .eq('id', d.id)
      .eq('league_id', leagueId);
    if (error) return { error: error.message, success: null };
  }

  for (const d of divisions) {
    for (const [seat, userId] of d.members.entries()) {
      const { error } = await supabase
        .from('division_members')
        .update({ division_id: d.id, seat })
        .eq('league_id', leagueId)
        .eq('season_id', season.id)
        .eq('user_id', userId);
      if (error) return { error: error.message, success: null };
    }
  }

  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath('/dashboard');
  revalidatePath('/table');

  return {
    error: null,
    success: 'Saved. Changes apply from the next gameweek’s draft.',
  };
}
