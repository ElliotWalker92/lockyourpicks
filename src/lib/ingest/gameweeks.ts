import type { SupabaseClient } from '@supabase/supabase-js';

import {
  blocksFrom,
  draftWindows,
  MIN_FIXTURES_PER_GAMEWEEK,
} from '@/lib/gameweek-blocks';
import type { Database } from '@/lib/types';

/**
 * Gameweeks are the app's own rounds, not any competition's matchday.
 *
 * They have to be ours because players draft across six competitions at once
 * and those competitions' rounds don't line up — a Premier League matchday,
 * an FA Cup tie and a midweek EFL Cup round can all fall in the same week.
 *
 * A gameweek is a *block* of fixtures rather than a calendar window: Tuesday
 * to Thursday is one round, Friday to Monday is the next. See
 * `@/lib/gameweek-blocks` for why the fixed Tuesday→Monday window had to go.
 *
 * Numbering is chronological and derived, so it always reads 1..N in kickoff
 * order however the fixture list shifts underneath it.
 */

export type FixtureLike = {
  id: string;
  kickoff_at: string;
  gameweek_id: string;
};

/** Numbers are reassigned through this offset so the unique index never collides. */
const RENUMBER_OFFSET = 10_000;

async function allSeasonFixtures(
  supabase: SupabaseClient<Database>,
  seasonId: string,
): Promise<FixtureLike[]> {
  const { data: gameweeks } = await supabase
    .from('gameweeks')
    .select('id')
    .eq('season_id', seasonId);

  const ids = (gameweeks ?? []).map((g) => g.id);
  if (!ids.length) return [];

  const rows: FixtureLike[] = [];
  for (let offset = 0; offset < 10_000; offset += 1000) {
    const { data } = await supabase
      .from('fixtures')
      .select('id, kickoff_at, gameweek_id')
      .in('gameweek_id', ids)
      .order('kickoff_at', { ascending: true })
      .range(offset, offset + 999);
    if (!data?.length) break;
    rows.push(...(data as FixtureLike[]));
    if (data.length < 1000) break;
  }
  return rows;
}

export type RecutReport = {
  gameweeks: number;
  fixturesMoved: number;
  draftsCleared: number;
  smallest: number;
  shortestWindowHours: number;
};

/**
 * Re-cut a season's gameweeks from its fixtures.
 *
 * Destructive by design: fixtures move between gameweeks, so any pick made
 * against the old arrangement is a pick in a draft whose gameweek no longer
 * owns that fixture. Drafts and settled scores for the season are cleared and
 * rebuilt rather than left describing a shape that no longer exists.
 *
 * Not something to run on a schedule — `syncGameweeks` is the safe one.
 */
export async function recutSeason(
  supabase: SupabaseClient<Database>,
  seasonId: string,
): Promise<RecutReport> {
  const fixtures = await allSeasonFixtures(supabase, seasonId);
  if (!fixtures.length) {
    return {
      gameweeks: 0,
      fixturesMoved: 0,
      draftsCleared: 0,
      smallest: 0,
      shortestWindowHours: 0,
    };
  }

  const blocks = blocksFrom(fixtures, (f) => new Date(f.kickoff_at));
  const windows = draftWindows(blocks);

  const { data: oldGameweeks } = await supabase
    .from('gameweeks')
    .select('id')
    .eq('season_id', seasonId);
  const oldIds = (oldGameweeks ?? []).map((g) => g.id);

  // Clear what the old arrangement produced. Drafts cascade to picks.
  const { count: draftsCleared } = await supabase
    .from('drafts')
    .select('*', { count: 'exact', head: true })
    .in('gameweek_id', oldIds);

  await supabase.from('gameweek_scores').delete().in('gameweek_id', oldIds);
  await supabase.from('drafts').delete().in('gameweek_id', oldIds);

  // Create the new gameweeks out of the way of the existing numbering.
  const created: string[] = [];
  let fixturesMoved = 0;

  for (const [i, block] of blocks.entries()) {
    const { opensAt, closesAt } = windows[i];
    const { data: gw, error } = await supabase
      .from('gameweeks')
      .insert({
        season_id: seasonId,
        number: RENUMBER_OFFSET + i + 1,
        name: `Gameweek ${i + 1}`,
        draft_opens_at: opensAt.toISOString(),
        draft_closes_at: closesAt.toISOString(),
        first_kickoff_at: block.start.toISOString(),
        status: 'upcoming',
      })
      .select('id')
      .single();

    if (error || !gw) throw new Error(`recutSeason: ${error?.message}`);
    created.push(gw.id);

    // Reassign in chunks — a block can carry a hundred-odd fixtures.
    const ids = block.items.map((f) => f.id);
    for (let c = 0; c < ids.length; c += 200) {
      const slice = ids.slice(c, c + 200);
      const { error: moveError } = await supabase
        .from('fixtures')
        .update({ gameweek_id: gw.id })
        .in('id', slice);
      if (moveError) throw new Error(`recutSeason move: ${moveError.message}`);
      fixturesMoved += slice.length;
    }
  }

  // Old gameweeks are childless now. Deleting them before the move would have
  // taken their fixtures with them — the foreign key cascades.
  if (oldIds.length) {
    await supabase.from('gameweeks').delete().in('id', oldIds);
  }

  for (const [i, id] of created.entries()) {
    await supabase
      .from('gameweeks')
      .update({ number: i + 1 })
      .eq('id', id);
  }

  const sizes = blocks.map((b) => b.items.length);
  const hours = windows.map(
    (w) => (w.closesAt.getTime() - w.opensAt.getTime()) / 3_600_000,
  );

  return {
    gameweeks: blocks.length,
    fixturesMoved,
    draftsCleared: draftsCleared ?? 0,
    smallest: Math.min(...sizes),
    shortestWindowHours: Math.round(Math.min(...hours)),
  };
}

/**
 * Keep gameweeks in step with the fixture list, without disturbing live ones.
 *
 * A gameweek that has started drafting is frozen: its fixtures stay where
 * they are and its window is left alone, because players have already picked
 * against it. Everything after it is re-cut from the current fixtures, which
 * is what absorbs postponements and newly-scheduled cup rounds.
 *
 * This is what the weekly ingest calls.
 */
export async function syncGameweeks(
  supabase: SupabaseClient<Database>,
  seasonId: string,
): Promise<{ frozen: number; recut: number }> {
  const nowIso = new Date().toISOString();

  const { data: gameweeks } = await supabase
    .from('gameweeks')
    .select('id, number, draft_closes_at')
    .eq('season_id', seasonId)
    .order('draft_closes_at');

  const all = gameweeks ?? [];
  const { data: drafted } = await supabase
    .from('drafts')
    .select('gameweek_id')
    .in('gameweek_id', all.map((g) => g.id));

  // Frozen: anything already being drafted, and anything already under way.
  // History and live rounds are never re-cut — players have picked against
  // them, and a fixture that has kicked off cannot move.
  const hasDraft = new Set((drafted ?? []).map((d) => d.gameweek_id));
  const frozen = new Set(
    all
      .filter((g) => hasDraft.has(g.id) || g.draft_closes_at <= nowIso)
      .map((g) => g.id),
  );

  const fixtures = await allSeasonFixtures(supabase, seasonId);
  const loose = fixtures.filter((f) => !frozen.has(f.gameweek_id));
  if (!loose.length) return { frozen: frozen.size, recut: 0 };

  const blocks = blocksFrom(loose, (f) => new Date(f.kickoff_at));

  // The first loose gameweek's draft opens when the last frozen one locks.
  const lastFrozenClose = all
    .filter((g) => frozen.has(g.id))
    .map((g) => g.draft_closes_at)
    .sort()
    .pop();

  const windows = draftWindows(blocks);
  if (lastFrozenClose && windows.length) {
    windows[0] = { ...windows[0], opensAt: new Date(lastFrozenClose) };
  }

  const created: string[] = [];
  for (const [i, block] of blocks.entries()) {
    const { data: gw, error } = await supabase
      .from('gameweeks')
      .insert({
        season_id: seasonId,
        number: RENUMBER_OFFSET + i + 1,
        name: 'Gameweek',
        draft_opens_at: windows[i].opensAt.toISOString(),
        draft_closes_at: windows[i].closesAt.toISOString(),
        first_kickoff_at: block.start.toISOString(),
        status: 'upcoming',
      })
      .select('id')
      .single();
    if (error || !gw) throw new Error(`syncGameweeks: ${error?.message}`);
    created.push(gw.id);

    const ids = block.items.map((f) => f.id);
    for (let c = 0; c < ids.length; c += 200) {
      const { error: moveError } = await supabase
        .from('fixtures')
        .update({ gameweek_id: gw.id })
        .in('id', ids.slice(c, c + 200));
      if (moveError) throw new Error(`syncGameweeks move: ${moveError.message}`);
    }
  }

  // The old un-frozen gameweeks are empty now; dropping them earlier would
  // have taken their fixtures with them.
  const staleIds = all.map((g) => g.id).filter((id) => !frozen.has(id));
  if (staleIds.length) {
    await supabase.from('gameweeks').delete().in('id', staleIds);
  }

  const { data: fresh } = await supabase
    .from('gameweeks')
    .select('id')
    .eq('season_id', seasonId)
    .order('draft_closes_at');

  for (const [i, g] of (fresh ?? []).entries()) {
    await supabase
      .from('gameweeks')
      .update({ number: i + 1, name: `Gameweek ${i + 1}` })
      .eq('id', g.id);
  }

  return { frozen: frozen.size, recut: created.length };
}

export { MIN_FIXTURES_PER_GAMEWEEK };
