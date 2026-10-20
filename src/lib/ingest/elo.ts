import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isTransientApiError, getFixtures } from '@/lib/api-football';
import { HOME_ADV } from '@/lib/elo';
import { callRpc } from '@/lib/supabase/rpc';
import type { Database } from '@/lib/types';

/**
 * Recompute every team's Elo rating from scratch.
 *
 * Idempotent by design: it always starts from the division-based seeds below
 * and replays history in date order, so running it twice gives the same answer.
 * Incrementally nudging ratings after each result is cheaper but drifts — a
 * missed run or a double-applied result is invisible and permanent.
 *
 * History comes from two places:
 *   - last season, fetched transiently from the provider (not stored; those
 *     fixtures have no gameweek and would pollute the fixtures table)
 *   - this season's finished fixtures, read from our own database
 *
 * Starting ratings are set by division rather than giving everyone 1500.
 * A League Two side is not the equal of a Premier League side, and seeding
 * them level would take most of a season to correct — during which every
 * probability shown to players would be wrong in the same direction.
 */

/** Roughly the real gap: ~380 points ≈ the favourite winning about 90%. */
const TIER_SEED: Record<number, number> = {
  1: 1500, // Premier League
  2: 1350, // Championship
  3: 1220, // League One
  4: 1120, // League Two
};
const DEFAULT_SEED = 1300;

/**
 * K-factor. 20 is the common club-football value — responsive enough to track
 * a season's form without letting one cup upset rewrite a team's rating.
 */
const K = 20;

export type EloReport = {
  seasonsUsed: number[];
  historicalMatches: number;
  currentSeasonMatches: number;
  teamsRated: number;
  spread: { top: [string, number][]; bottom: [string, number][] };
  /** Refusals that the next run retries; they still block a rewrite. */
  warnings: string[];
  errors: string[];
};

type Played = { home: string; away: string; hs: number; as: number; at: number };

function expectedScore(a: number, b: number) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/** Standard Elo update, home advantage folded into the expectation. */
function applyResult(
  ratings: Map<string, number>,
  m: Played,
  seed: (id: string) => number,
) {
  const home = ratings.get(m.home) ?? seed(m.home);
  const away = ratings.get(m.away) ?? seed(m.away);

  const expHome = expectedScore(home + HOME_ADV, away);
  const scoreHome = m.hs > m.as ? 1 : m.hs === m.as ? 0.5 : 0;

  ratings.set(m.home, home + K * (scoreHome - expHome));
  ratings.set(m.away, away + K * (1 - scoreHome - (1 - expHome)));
}

export async function recomputeElo(
  supabase: SupabaseClient<Database>,
): Promise<EloReport> {
  const report: EloReport = {
    seasonsUsed: [],
    historicalMatches: 0,
    currentSeasonMatches: 0,
    teamsRated: 0,
    spread: { top: [], bottom: [] },
    warnings: [],
    errors: [],
  };

  const { data: season } = await supabase
    .from('seasons')
    .select('starts_on')
    .eq('is_active', true)
    .single();
  const seasonYear = new Date(season!.starts_on).getUTCFullYear();
  const previous = seasonYear - 1;

  const { data: competitions } = await supabase
    .from('competitions')
    .select('id, code, tier, provider_league_id')
    .eq('is_active', true);

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, provider_team_id');

  const byProviderId = new Map<number, string>();
  const nameOf = new Map<string, string>();
  for (const t of teams ?? []) {
    if (t.provider_team_id !== null) byProviderId.set(t.provider_team_id, t.id);
    nameOf.set(t.id, t.name);
  }

  // Seed by the division a team is currently in.
  const seedOf = new Map<string, number>();
  for (const c of competitions ?? []) {
    if (!c.provider_league_id || c.tier === null) continue;
    const { data: fx } = await supabase
      .from('fixtures')
      .select('home_team_id, away_team_id')
      .eq('competition_id', c.id);
    for (const f of fx ?? []) {
      const s = TIER_SEED[c.tier] ?? DEFAULT_SEED;
      seedOf.set(f.home_team_id, s);
      seedOf.set(f.away_team_id, s);
    }
  }
  const seed = (id: string) => seedOf.get(id) ?? DEFAULT_SEED;

  // ---- Last season, straight from the provider ----
  let historyIncomplete = false;
  // Whether anything that broke the history was worth waking somebody for.
  // A refused request is not: the minute ceiling is enforced per IP and
  // Workers share outbound addresses, so a run can be turned away because
  // of traffic that isn't ours.
  let incompleteForGoodReason = false;
  const played: Played[] = [];
  for (const c of competitions ?? []) {
    if (!c.provider_league_id) continue;
    try {
      const fixtures = await getFixtures(c.provider_league_id, previous);
      for (const f of fixtures) {
        if (f.goals.home === null || f.goals.away === null) continue;
        const home = byProviderId.get(f.teams.home.id);
        const away = byProviderId.get(f.teams.away.id);
        // Teams we don't hold — non-league cup entrants — are skipped rather
        // than invented, so they can't drag a real team's rating around.
        if (!home || !away) continue;
        played.push({
          home,
          away,
          hs: f.goals.home,
          as: f.goals.away,
          at: new Date(f.fixture.date).getTime(),
        });
      }
      if (!report.seasonsUsed.includes(previous)) {
        report.seasonsUsed.push(previous);
      }
    } catch (err) {
      // Ratings are computed from the whole history at once, so a season
      // that didn't arrive doesn't make them slightly worse — it makes them
      // wrong, for every club, silently. Record it and refuse to write.
      historyIncomplete = true;
      const message = `${c.code} ${previous}: ${err instanceof Error ? err.message : String(err)}`;
      if (isTransientApiError(err)) {
        report.warnings.push(message);
      } else {
        incompleteForGoodReason = true;
        report.errors.push(message);
      }
    }
  }
  report.historicalMatches = played.length;

  // ---- This season's finished fixtures, from our own tables ----
  for (let offset = 0; offset < 5000; offset += 1000) {
    const { data: fx } = await supabase
      .from('fixtures')
      .select('home_team_id, away_team_id, home_score, away_score, kickoff_at')
      .eq('status', 'finished')
      .not('home_score', 'is', null)
      .range(offset, offset + 999);
    if (!fx?.length) break;
    for (const f of fx) {
      played.push({
        home: f.home_team_id,
        away: f.away_team_id,
        hs: f.home_score!,
        as: f.away_score!,
        at: new Date(f.kickoff_at).getTime(),
      });
      report.currentSeasonMatches++;
    }
    if (fx.length < 1000) break;
  }
  if (report.currentSeasonMatches > 0) report.seasonsUsed.push(seasonYear);

  // ---- Replay in date order ----
  played.sort((a, b) => a.at - b.at);
  const ratings = new Map<string, number>();
  for (const m of played) applyResult(ratings, m, seed);

  // Teams with no history keep their division seed rather than 1500.
  for (const t of teams ?? []) {
    if (!ratings.has(t.id)) ratings.set(t.id, seed(t.id));
  }

  const rows = Array.from(ratings.entries()).map(([id, rating]) => ({
    id,
    elo_rating: Math.round(rating * 100) / 100,
    elo_updated_at: new Date().toISOString(),
  }));

  // One statement. Row by row this was one request per team, and Workers
  // Free stops a job at 50 — roughly thirty clubs were rated each week and
  // the rest kept whatever they had.
  if (historyIncomplete) {
    // Not writing is the right answer either way: ratings are computed from
    // the whole history at once, so a season that didn't arrive doesn't make
    // them slightly worse, it makes them wrong for every club.
    //
    // Whether it's worth an email is a different question. If the only thing
    // that went wrong was a request being refused, the job did its job — it
    // declined to write from partial data and will try again next week, and
    // last week's ratings are still perfectly good. Alerting on that trains
    // somebody to ignore the alert that matters.
    const note =
      'history incomplete — ratings left as they were rather than rewritten from partial data';
    if (incompleteForGoodReason) report.errors.push(note);
    else report.warnings.push(`${note} (every cause was a refused request)`);

    report.teamsRated = 0;
    return report;
  }

  const { error: eloError } = await callRpc<number>(supabase, 'apply_team_elo', {
    p_rows: rows.map(({ id, elo_rating }) => ({ id, elo_rating })),
  });
  if (eloError) report.errors.push(`apply elo: ${eloError.message}`);

  report.teamsRated = rows.length;
  const sorted = rows
    .map((r) => [nameOf.get(r.id) ?? r.id, r.elo_rating] as [string, number])
    .sort((a, b) => b[1] - a[1]);
  report.spread.top = sorted.slice(0, 5);
  report.spread.bottom = sorted.slice(-5);

  return report;
}
