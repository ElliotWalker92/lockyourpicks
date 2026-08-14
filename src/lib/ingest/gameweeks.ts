import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/types';

/**
 * Gameweeks are the app's own weekly cycle, not any competition's matchday.
 *
 * They have to be ours because players draft across six competitions at once,
 * and those competitions' own "rounds" don't line up — a Premier League
 * matchday, an FA Cup third round and a midweek EFL Cup tie can all fall in the
 * same week.
 *
 * A gameweek runs **Tuesday 00:00 UTC → Monday 23:59 UTC**. That puts the draft
 * window at the quiet start of the week and closes it at the first kickoff,
 * which is usually Friday or Saturday — roughly three days to get nine picks in.
 */

const MS_PER_DAY = 86_400_000;
const TUESDAY = 2; // JS getUTCDay(): Sunday = 0

/** The Tuesday on or before `date`, at 00:00 UTC. */
export function weekStart(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const shift = (d.getUTCDay() - TUESDAY + 7) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d;
}

export type GameweekWindow = {
  number: number;
  startsAt: Date;
  endsAt: Date;
};

/**
 * Weekly windows spanning the season, numbered from 1.
 */
export function buildWindows(seasonStart: Date, seasonEnd: Date): GameweekWindow[] {
  const windows: GameweekWindow[] = [];
  const cursor = weekStart(seasonStart);
  let number = 1;

  while (cursor <= seasonEnd) {
    const startsAt = new Date(cursor);
    const endsAt = new Date(cursor.getTime() + 7 * MS_PER_DAY - 1);
    windows.push({ number, startsAt, endsAt });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
    number++;
  }

  return windows;
}

/**
 * Create any missing gameweek rows for the active season.
 *
 * `draft_closes_at` is provisional here — it's set to the window start plus
 * four days as a placeholder, then corrected to the real first kickoff by
 * `syncGameweekKickoffs` once fixtures land. A gameweek with no fixtures keeps
 * the placeholder and simply never opens a draft.
 */
export async function ensureGameweeks(
  supabase: SupabaseClient<Database>,
  seasonId: string,
  seasonStart: Date,
  seasonEnd: Date,
): Promise<number> {
  const windows = buildWindows(seasonStart, seasonEnd);

  const rows = windows.map((w) => ({
    season_id: seasonId,
    number: w.number,
    name: `Gameweek ${w.number}`,
    draft_opens_at: w.startsAt.toISOString(),
    draft_closes_at: new Date(
      w.startsAt.getTime() + 4 * MS_PER_DAY,
    ).toISOString(),
  }));

  const { error } = await supabase
    .from('gameweeks')
    .upsert(rows, { onConflict: 'season_id,number', ignoreDuplicates: true });

  if (error) throw new Error(`ensureGameweeks: ${error.message}`);
  return rows.length;
}

/**
 * Point each gameweek's draft deadline at its real first kickoff.
 *
 * This is what makes the draft honest: turn lengths are derived from the time
 * remaining until `draft_closes_at`, so if that value is a placeholder the
 * whole schedule is wrong.
 */
export async function syncGameweekKickoffs(
  supabase: SupabaseClient<Database>,
  seasonId: string,
): Promise<number> {
  const { data: gameweeks, error } = await supabase
    .from('gameweeks')
    .select('id, draft_opens_at')
    .eq('season_id', seasonId);

  if (error) throw new Error(`syncGameweekKickoffs: ${error.message}`);

  let updated = 0;

  for (const gw of gameweeks ?? []) {
    const { data: earliest } = await supabase
      .from('fixtures')
      .select('kickoff_at')
      .eq('gameweek_id', gw.id)
      .order('kickoff_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!earliest) continue;

    const { error: updateError } = await supabase
      .from('gameweeks')
      .update({
        first_kickoff_at: earliest.kickoff_at,
        draft_closes_at: earliest.kickoff_at,
      })
      .eq('id', gw.id);

    if (!updateError) updated++;
  }

  return updated;
}
