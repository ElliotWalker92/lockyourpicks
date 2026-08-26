import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/types';

export type Round = {
  gameweekId: string;
  number: number;
  status: string;
  /** Every draft for this gameweek across the divisions asked about. */
  draftIds: string[];
};

/**
 * The gameweeks a set of divisions has actually drafted, newest first.
 *
 * Drafted, not scheduled: the season has 64 gameweeks and a strip of 64
 * chips is a wall, not a control. What a player wants to step back through
 * is the rounds they played.
 */
export async function loadRounds(
  supabase: SupabaseClient<Database>,
  divisionIds: string[],
): Promise<Round[]> {
  if (!divisionIds.length) return [];

  const { data } = await supabase
    .from('drafts')
    .select('id, gameweek_id, gameweeks(number, status)')
    .in('division_id', divisionIds);

  const one = <T,>(v: T | T[]): T => (Array.isArray(v) ? v[0] : v);
  const rounds = new Map<string, Round>();

  for (const row of data ?? []) {
    const gw = one(row.gameweeks) as { number: number; status: string } | null;
    const entry = rounds.get(row.gameweek_id) ?? {
      gameweekId: row.gameweek_id,
      number: gw?.number ?? 0,
      status: gw?.status ?? 'upcoming',
      draftIds: [],
    };
    entry.draftIds.push(row.id);
    rounds.set(row.gameweek_id, entry);
  }

  return [...rounds.values()].sort((a, b) => b.number - a.number);
}
