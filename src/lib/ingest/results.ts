import type { SupabaseClient } from '@supabase/supabase-js';

import { getFixturesByDate, mapStatus } from '@/lib/api-football';
import { callRpc } from '@/lib/supabase/rpc';
import type { Database } from '@/lib/types';

export type ResultsReport = {
  datesChecked: string[];
  providerFixtures: number;
  updated: number;
  finished: number;
  gameweeksSettled: number;
  errors: string[];
};

/** YYYY-MM-DD, `offset` days from today, in UTC. */
function isoDate(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Poll recent results and settle whatever is due.
 *
 * Fetches **by date**, not per competition: one `/fixtures?date=` call returns
 * every fixture across all six competitions for that day, so a three-day window
 * costs three requests rather than eighteen. On the Pro plan's 7,500/day that's
 * academic, but it also means a 10-minute cadence through a Saturday is ~50
 * calls instead of ~300.
 *
 * The window reaches two days back so a match that finished late, or had its
 * score corrected after the fact, still gets picked up.
 */
export async function ingestResults(
  supabase: SupabaseClient<Database>,
  { daysBack = 2, daysForward = 1 }: { daysBack?: number; daysForward?: number } = {},
): Promise<ResultsReport> {
  const dates: string[] = [];
  for (let d = -daysBack; d <= daysForward; d++) dates.push(isoDate(d));

  const report: ResultsReport = {
    datesChecked: dates,
    providerFixtures: 0,
    updated: 0,
    finished: 0,
    gameweeksSettled: 0,
    errors: [],
  };

  // provider fixture id → our row
  const updates = new Map<
    number,
    { home_score: number | null; away_score: number | null; status: string }
  >();

  for (const date of dates) {
    try {
      const fixtures = await getFixturesByDate(date);
      report.providerFixtures += fixtures.length;

      for (const f of fixtures) {
        updates.set(f.fixture.id, {
          home_score: f.goals.home,
          away_score: f.goals.away,
          status: mapStatus(f.fixture.status.short),
        });
      }
    } catch (err) {
      report.errors.push(
        `${date}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (updates.size > 0) {
    // Only touch fixtures we actually hold — the date feed is worldwide, and
    // most of it belongs to competitions we don't run.
    const ids = Array.from(updates.keys());
    const ours: { id: string; provider_fixture_id: number }[] = [];

    for (let i = 0; i < ids.length; i += 500) {
      const { data } = await supabase
        .from('fixtures')
        .select('id, provider_fixture_id')
        .in('provider_fixture_id', ids.slice(i, i + 500));
      ours.push(
        ...((data ?? []) as { id: string; provider_fixture_id: number }[]),
      );
    }

    for (const row of ours) {
      const update = updates.get(row.provider_fixture_id);
      if (!update) continue;

      const { error } = await supabase
        .from('fixtures')
        .update({
          home_score: update.home_score,
          away_score: update.away_score,
          status: update.status as Database['public']['Enums']['fixture_status'],
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      if (error) report.errors.push(`fixture ${row.id}: ${error.message}`);
      else {
        report.updated++;
        if (update.status === 'finished') report.finished++;
      }
    }
  }

  // Settlement is idempotent — it rescores what has finished and only declares
  // a gameweek settled once nothing is left to play.
  const { data: settled, error: settleError } = await callRpc<number>(
    supabase,
    'settle_due_gameweeks',
  );

  if (settleError) report.errors.push(`settle: ${settleError.message}`);
  else report.gameweeksSettled = settled ?? 0;

  return report;
}
