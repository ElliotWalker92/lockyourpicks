import type { SupabaseClient } from '@supabase/supabase-js';

import {
  attachToBlocks,
  blocksFrom,
  draftWindows,
  MIN_FIXTURES_PER_GAMEWEEK,
} from '@/lib/gameweek-blocks';
import { callRpc } from '@/lib/supabase/rpc';
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
  competition_id: string;
};

/** Numbers are reassigned through this offset so the unique index never collides. */
/** What apply_recut needs: each block's window and the fixtures in it. */
function planOf(
  blocks: { start: Date; items: { id: string }[] }[],
  windows: { opensAt: Date; closesAt: Date }[],
) {
  return blocks.map((block, i) => ({
    opens_at: windows[i].opensAt.toISOString(),
    closes_at: windows[i].closesAt.toISOString(),
    first_kickoff_at: block.start.toISOString(),
    fixture_ids: block.items.map((f) => f.id),
  }));
}

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
      .select('id, kickoff_at, gameweek_id, competition_id')
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

  // Destructive by design, and all-or-nothing: drafts and scores for the
  // old shape are cleared in the same transaction that replaces it.
  const { data: applied, error } = await callRpc<{
    fixtures_moved: number;
    drafts_cleared: number;
  }>(supabase, 'apply_recut', {
    p_season_id: seasonId,
    p_replace: (oldGameweeks ?? []).map((g) => g.id),
    p_blocks: planOf(blocks, windows),
    p_clear_drafts: true,
  });
  if (error) throw new Error(`recutSeason: ${error.message}`);
  const fixturesMoved = applied?.fixtures_moved ?? 0;
  const draftsCleared = applied?.drafts_cleared ?? 0;

  const sizes = blocks.map((b) => b.items.length);
  const hours = windows.map(
    (w) => (w.closesAt.getTime() - w.opensAt.getTime()) / 3_600_000,
  );

  return {
    gameweeks: blocks.length,
    fixturesMoved,
    draftsCleared,
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

  // Only the spine decides where the rounds fall — see migration 0039.
  // Everything else is slotted into whichever round it lands in, so a
  // competition one group opted into cannot move another group's deadlines.
  const { data: calendarComps } = await supabase
    .from('competitions')
    .select('id')
    .eq('sets_calendar', true);
  const spineIds = new Set((calendarComps ?? []).map((c) => c.id));

  const kickoff = (f: FixtureLike) => new Date(f.kickoff_at);
  const spine = loose.filter((f) => spineIds.has(f.competition_id));
  const rest = loose.filter((f) => !spineIds.has(f.competition_id));

  // If nothing is marked — an older database, or a season of nothing but
  // extras — fall back to cutting from everything rather than refusing to
  // cut at all. A calendar built from the wrong fixtures beats none.
  const blocks = spine.length
    ? attachToBlocks(blocksFrom(spine, kickoff), rest, kickoff)
    : blocksFrom(loose, kickoff);

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

  // Everything unfrozen is replaced; the database does the rest in one
  // transaction. This used to be an insert and a move per block, a delete,
  // and an update per gameweek — well over the 50 requests Workers Free
  // allows — and the one time it was cut off it left the season half
  // migrated: new gameweeks holding the fixtures, the old ones still there
  // and empty, nothing renumbered.
  const replace = all.map((g) => g.id).filter((id) => !frozen.has(id));
  const { data, error } = await callRpc<{ created: number }>(
    supabase,
    'apply_recut',
    {
      p_season_id: seasonId,
      p_replace: replace,
      p_blocks: planOf(blocks, windows),
    },
  );
  if (error) throw new Error(`syncGameweeks: ${error.message}`);

  return { frozen: frozen.size, recut: data?.created ?? 0 };
}

export { MIN_FIXTURES_PER_GAMEWEEK };
