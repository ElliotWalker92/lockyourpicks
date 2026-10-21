import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isTransientApiError, getFixtures } from '@/lib/api-football';
import { competitionsInPlay } from '@/lib/competitions';
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
/**
 * What we assume about a club with no division of ours.
 *
 * Since 0041 this is never shown to anybody: a club with no tier and fewer
 * than MIN_UNSEEDED_RESULTS results gets no rating at all. It still has to
 * be a number, though, because the club plays in the replay as somebody
 * else's cup opponent, and that opponent's rating moves by how good we
 * thought the other side was.
 *
 * At 1300 it sat between the Championship and League One, so a Football
 * League club that beat a non-league side last season gained as though it
 * had beaten a League One side, and a club that lost to one was barely
 * punished. 1000 is one step on from the gradient the tiers already use —
 * 1500, 1350, 1220, 1120, gaps of 150, 130, 100 — which puts it about where
 * the National League sits. Round, and deliberately an estimate: FA Cup
 * first-round entrants run from the National League down to the Isthmian
 * and Southern Leagues, and nothing in our data says which.
 */
const DEFAULT_SEED = 1000;

/**
 * How many results a club with no division of ours needs before we'll put a
 * rating on it.
 *
 * Elo starts every club from a seed and moves it by at most K a game, so a
 * club seeded at DEFAULT_SEED with one result is that seed nudged by twenty
 * points: a guess with a rounding error on it, not a measurement. Eastleigh,
 * Scunthorpe, Halifax, Carlisle and Boreham Wood all sat between 1283 and
 * 1300 on one to three cup ties, which read as "about League One" and was
 * nothing of the sort.
 *
 * Five is the same bar the model uses before it will price a home or away
 * record (MIN_TABLE_GAMES), and for the same reason. A club that does have a
 * division of ours needs none of this: its seed is real information, because
 * it says which division.
 */
const MIN_UNSEEDED_RESULTS = 5;

/**
 * K-factor. 20 is the common club-football value — responsive enough to track
 * a season's form without letting one cup upset rewrite a team's rating.
 */
const K = 20;

export type EloReport = {
  seasonsUsed: number[];
  /**
   * Competition-seasons fetched from the provider this run. Zero is the
   * steady state — a finished season is stored once and read thereafter.
   */
  seasonsImported: number;
  historicalMatches: number;
  currentSeasonMatches: number;
  teamsRated: number;
  /**
   * Clubs we deliberately left without a rating: no results we hold, and no
   * division to seed them from. Not an error — it is the honest answer — but
   * worth seeing, because a club appearing here that plays in a league we
   * cover means its fixtures aren't being ingested.
   */
  unrated: string[];
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
    seasonsImported: 0,
    historicalMatches: 0,
    currentSeasonMatches: 0,
    teamsRated: 0,
    unrated: [],
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
    .in('id', (await competitionsInPlay(supabase)).map((c) => c.id));

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

  // ---- Last season, from our own store ----
  //
  // A finished season cannot change, so it is fetched once and kept. The
  // weekly run makes no provider calls for history at all once that has
  // happened, which is what takes this job out from under the per-minute
  // ceiling — see migration 0036.
  let historyIncomplete = false;
  // Whether anything that broke the history was worth waking somebody for.
  // A refused request is not: the minute ceiling is enforced per IP and
  // Workers share outbound addresses, so a run can be turned away because
  // of traffic that isn't ours.
  let incompleteForGoodReason = false;
  const played: Played[] = [];

  const { data: imported } = await supabase
    .from('historical_imports')
    .select('competition_id, match_count')
    .eq('season', previous);
  const haveSeason = new Set((imported ?? []).map((r) => r.competition_id));

  // Everything already stored, in one read rather than one per competition.
  const storedFor = new Map<string, Played[]>();
  for (let from = 0; ; from += 1000) {
    const { data: rows } = await supabase
      .from('historical_matches')
      .select(
        'competition_id, home_team_id, away_team_id, home_score, away_score, kicked_off_at',
      )
      .eq('season', previous)
      .range(from, from + 999);
    if (!rows?.length) break;
    for (const r of rows) {
      const list = storedFor.get(r.competition_id) ?? [];
      list.push({
        home: r.home_team_id,
        away: r.away_team_id,
        hs: r.home_score,
        as: r.away_score,
        at: new Date(r.kicked_off_at).getTime(),
      });
      storedFor.set(r.competition_id, list);
    }
    if (rows.length < 1000) break;
  }

  for (const c of competitions ?? []) {
    if (!c.provider_league_id) continue;

    if (haveSeason.has(c.id)) {
      played.push(...(storedFor.get(c.id) ?? []));
      if (!report.seasonsUsed.includes(previous)) {
        report.seasonsUsed.push(previous);
      }
      continue;
    }

    try {
      const fixtures = await getFixtures(c.provider_league_id, previous);
      const keep: {
        competition_id: string;
        season: number;
        provider_fixture_id: number;
        home_team_id: string;
        away_team_id: string;
        home_score: number;
        away_score: number;
        kicked_off_at: string;
      }[] = [];

      for (const f of fixtures) {
        if (f.goals.home === null || f.goals.away === null) continue;
        const home = byProviderId.get(f.teams.home.id);
        const away = byProviderId.get(f.teams.away.id);
        // Teams we don't hold — non-league cup entrants — are skipped rather
        // than invented, so they can't drag a real team's rating around.
        if (!home || !away) continue;
        keep.push({
          competition_id: c.id,
          season: previous,
          provider_fixture_id: f.fixture.id,
          home_team_id: home,
          away_team_id: away,
          home_score: f.goals.home,
          away_score: f.goals.away,
          kicked_off_at: new Date(f.fixture.date).toISOString(),
        });
      }

      // Rows first, then the marker. A failure between the two leaves rows
      // with no claim that the season is complete, so the next run fetches
      // it again — which is the right way round.
      for (let i = 0; i < keep.length; i += 500) {
        const { error } = await supabase
          .from('historical_matches')
          .upsert(keep.slice(i, i + 500), { onConflict: 'provider_fixture_id' });
        if (error) throw new Error(`storing ${c.code} ${previous}: ${error.message}`);
      }
      await supabase
        .from('historical_imports')
        .upsert(
          { competition_id: c.id, season: previous, match_count: keep.length },
          { onConflict: 'competition_id,season' },
        );

      report.seasonsImported += 1;
      played.push(
        ...keep.map((k) => ({
          home: k.home_team_id,
          away: k.away_team_id,
          hs: k.home_score,
          as: k.away_score,
          at: new Date(k.kicked_off_at).getTime(),
        })),
      );
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

  // ---- Who we'll actually put a number on ----
  //
  // A club has a basis if it plays in a division of ours, which tells us
  // roughly where it sits, or if we hold enough of its results for the
  // replay to have told us itself. `seedOf` is built from fixtures in
  // competitions that carry a tier, so a club in our tables purely as an FA
  // Cup entrant from the non-league pyramid is not in it.
  //
  // Such a club used to get DEFAULT_SEED, which put Cray Wanderers of the
  // Isthmian League between the Championship and League One; before that the
  // column default did worse and sat them level with Arsenal. One or two cup
  // ties didn't rescue it either — a seed nudged by twenty points a game is
  // still the seed. All of it is the same mistake, answering a question we
  // cannot answer, so now they get no rating and the model declines to price
  // their ties. See 0040 and 0041.
  const results = new Map<string, number>();
  for (const m of played) {
    results.set(m.home, (results.get(m.home) ?? 0) + 1);
    results.set(m.away, (results.get(m.away) ?? 0) + 1);
  }

  const unrated: { id: string; name: string }[] = [];
  for (const t of teams ?? []) {
    if (seedOf.has(t.id)) {
      // No history is fine here: the division seed is the answer.
      if (!ratings.has(t.id)) ratings.set(t.id, seed(t.id));
      continue;
    }
    if ((results.get(t.id) ?? 0) >= MIN_UNSEEDED_RESULTS) continue;
    // Drops a rating the replay produced as well as declining to invent one.
    ratings.delete(t.id);
    unrated.push({ id: t.id, name: nameOf.get(t.id) ?? t.id });
  }
  report.unrated = unrated.map((t) => t.name).sort();

  const rows = Array.from(ratings.entries()).map(([id, rating]) => ({
    id,
    elo_rating: Math.round(rating * 100) / 100,
  }));

  // Clearing matters as much as writing. These clubs were given
  // DEFAULT_SEED under the old rule and stamped, so leaving them out of the
  // payload would leave a 1300 sitting there unchallenged — which read as a
  // considered rating rather than a default and put Wimborne Town at the top
  // of auto_pick's queue. A null rating is the job saying so out loud; see
  // migration 0041.
  const clear = unrated.map((t) => ({ id: t.id, elo_rating: null }));

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
    p_rows: [...rows, ...clear],
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
