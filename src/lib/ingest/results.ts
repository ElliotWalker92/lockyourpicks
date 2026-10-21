import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getFixturesByDate,
  isTransientApiError,
  mapStatus,
} from '@/lib/api-football';
import { ingestStandings } from '@/lib/ingest/standings';
import { competitionsInPlay } from '@/lib/competitions';
import { callRpc } from '@/lib/supabase/rpc';
import type { Database } from '@/lib/types';

export type ResultsReport = {
  datesChecked: string[];
  providerFixtures: number;
  updated: number;
  finished: number;
  gameweeksSettled: number;
  /** League tables refreshed because one of their fixtures just finished. */
  tablesRefreshed: string[];
  /**
   * Refusals that fix themselves — a rate-limited date is polled again on
   * the next run. Recorded, but they don't make the run a failure: what
   * matters is whether a result is actually missing, which `errors` says.
   */
  warnings: string[];
  errors: string[];
};

/** YYYY-MM-DD, `offset` days from today, in UTC. */
function isoDate(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** How many dates one run may poll, so a long backlog can't blow the budget. */
const MAX_DATES = 14;

/** How long after kickoff a missing result stops being a timing question. */
const OVERDUE_AFTER_MS = 4 * 3_600_000;

/**
 * Poll recent results and settle whatever is due.
 *
 * Fetches **by date**, not per competition: one `/fixtures?date=` call returns
 * every fixture across all six competitions for that day, so a three-day window
 * costs three requests rather than eighteen. On the Pro plan's 7,500/day that's
 * academic, but it also means a 10-minute cadence through a Saturday is ~50
 * calls instead of ~300.
 *
 * The window is a rolling few days *plus every date that still has an unplayed
 * fixture on it*. A fixed lookback silently loses matches: miss more runs than
 * the window is wide — a deploy gap, an outage, a cron that wasn't wired up yet
 * — and those fixtures fall off the back of it, never get a result, and their
 * gameweek can never settle. Since settling is what opens the next gameweek,
 * one missed weekend would stall the season indefinitely. Asking the database
 * what's still outstanding makes the poll self-healing instead.
 */
export async function ingestResults(
  supabase: SupabaseClient<Database>,
  { daysBack = 2, daysForward = 1 }: { daysBack?: number; daysForward?: number } = {},
): Promise<ResultsReport> {
  const dates: string[] = [];
  for (let d = -daysBack; d <= daysForward; d++) dates.push(isoDate(d));

  // Any kickoff that has passed but still isn't resolved, however long ago.
  const { data: outstanding } = await supabase
    .from('fixtures')
    .select('kickoff_at')
    .in('status', ['scheduled', 'live'])
    .lt('kickoff_at', new Date().toISOString())
    .order('kickoff_at', { ascending: false })
    .limit(500);

  for (const f of outstanding ?? []) {
    const day = f.kickoff_at.slice(0, 10);
    if (!dates.includes(day)) dates.push(day);
  }

  // Newest first: a just-finished match matters more than an old straggler,
  // and the stragglers still get picked up on subsequent runs.
  dates.sort().reverse();
  dates.splice(MAX_DATES);

  const report: ResultsReport = {
    datesChecked: dates,
    providerFixtures: 0,
    updated: 0,
    finished: 0,
    gameweeksSettled: 0,
    tablesRefreshed: [],
    warnings: [],
    errors: [],
  };

  // Only our six competitions. The date feed is worldwide — a Saturday is
  // several thousand fixtures — and filtering here keeps the write small.
  const { data: competitions } = await supabase
    .from('competitions')
    .select('provider_league_id')
    .in('id', (await competitionsInPlay(supabase)).map((c) => c.id));
  const ours = new Set(
    (competitions ?? [])
      .map((c) => c.provider_league_id)
      .filter((id): id is number => id !== null),
  );

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
        if (!ours.has(f.league.id)) continue;
        updates.set(f.fixture.id, {
          home_score: f.goals.home,
          away_score: f.goals.away,
          status: mapStatus(f.fixture.status.short),
        });
      }
    } catch (err) {
      const message = `${date}: ${err instanceof Error ? err.message : String(err)}`;
      if (isTransientApiError(err)) report.warnings.push(message);
      else report.errors.push(message);
    }
  }

  // One statement for the lot. This used to be an UPDATE per fixture, and
  // Workers Free stops a job at 50 outbound requests — a full Saturday went
  // past that, and the rest of the afternoon's results simply didn't land.
  let finishedIn: string[] = [];
  if (updates.size > 0) {
    const { data, error } = await callRpc<{
      updated: number;
      finished: number;
      finished_competitions: string[];
    }>(supabase, 'apply_fixture_results', {
      p_updates: Array.from(updates, ([provider_fixture_id, u]) => ({
        provider_fixture_id,
        ...u,
      })),
    });

    if (error) report.errors.push(`apply results: ${error.message}`);
    else if (data) {
      report.updated = data.updated;
      report.finished = data.finished;
      finishedIn = data.finished_competitions;
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

  // A table only moves when a match in it finishes, so refresh exactly
  // those — within one results run of full time, rather than waiting for
  // the next of three scheduled table pulls a day.
  if (finishedIn.length) {
    try {
      const tables = await ingestStandings(supabase, {
        competitionIds: finishedIn,
      });
      report.tablesRefreshed = tables.competitions.map((c) => c.code);
      report.errors.push(...tables.errors.map((e) => `standings ${e}`));
      report.warnings.push(...tables.warnings.map((w) => `standings ${w}`));
    } catch (err) {
      report.errors.push(
        `standings: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // The honest test of this job: is anything that has been played still
  // without a result? A refused call that the next run picks up is noise;
  // a match finished hours ago and still blank is the thing worth an email,
  // because it stops a gameweek settling and nobody gets their points.
  const overdue = await supabase
    .from('fixtures')
    .select('kickoff_at', { count: 'exact' })
    .in('status', ['scheduled', 'live'])
    .lt('kickoff_at', new Date(Date.now() - OVERDUE_AFTER_MS).toISOString())
    .order('kickoff_at')
    .limit(1);

  if (overdue.count) {
    report.errors.push(
      `${overdue.count} fixture(s) played but still without a result, oldest ${overdue.data?.[0]?.kickoff_at?.slice(0, 16)}`,
    );
  }

  return report;
}
