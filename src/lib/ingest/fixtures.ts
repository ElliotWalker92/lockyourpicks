import type { SupabaseClient } from '@supabase/supabase-js';

import {
  currentSeasonOf,
  getEnglandLeagues,
  getFixtures,
  hasSeason,
  mapStatus,
  type ApiFixture,
  type ApiTeam,
} from '@/lib/api-football';
import type { Database } from '@/lib/types';
import { blocksFrom, draftWindows } from '@/lib/gameweek-blocks';
import { syncGameweeks } from './gameweeks';

export type IngestReport = {
  season: string;
  gameweeks: number;
  competitions: { code: string; season: number | null; fixtures: number; error?: string }[];
  teamsUpserted: number;
  fixturesUpserted: number;
  kickoffsSynced: number;
};

/**
 * Pull teams and fixtures for every active competition into our schema.
 *
 * Runs with the service-role client — it writes reference data that RLS
 * reserves for admins.
 *
 * Competitions are fetched at the season year matching *our* season start
 * (2026 for 2026/27), never at the provider's "current" season. Those differ:
 * in August 2026 the FA Cup still had 2025 marked current, and following that
 * pulled 872 fixtures from the 2025/26 competition — all of them before our
 * season began, so all of them silently discarded.
 *
 * A competition whose season isn't published yet is reported and skipped, so
 * "the FA Cup isn't out yet" is visible rather than looking like zero fixtures.
 */
export async function ingestFixtures(
  supabase: SupabaseClient<Database>,
): Promise<IngestReport> {
  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .select('id, name, starts_on, ends_on')
    .eq('is_active', true)
    .single();

  if (seasonError || !season) {
    throw new Error('No active season. Run migration 0004 first.');
  }

  const { data: competitions } = await supabase
    .from('competitions')
    .select('id, code, provider_league_id')
    .eq('is_active', true);

  // Season years are named by their starting year: 2026/27 is season 2026.
  const seasonYear = new Date(season.starts_on).getUTCFullYear();

  const apiLeagues = await getEnglandLeagues();
  const report: IngestReport = {
    season: season.name,
    gameweeks: 0,
    competitions: [],
    teamsUpserted: 0,
    fixturesUpserted: 0,
    kickoffsSynced: 0,
  };

  const teams = new Map<number, ApiTeam>();
  const allFixtures: { competitionId: string; fixture: ApiFixture }[] = [];

  for (const competition of competitions ?? []) {
    if (!competition.provider_league_id) continue;

    const apiLeague = apiLeagues.find(
      (l) => l.league.id === competition.provider_league_id,
    );

    if (!apiLeague) {
      report.competitions.push({
        code: competition.code,
        season: null,
        fixtures: 0,
        error: `provider has no league with id ${competition.provider_league_id}`,
      });
      continue;
    }

    if (!hasSeason(apiLeague, seasonYear)) {
      report.competitions.push({
        code: competition.code,
        season: null,
        fixtures: 0,
        error: `${seasonYear} not published yet (provider's current: ${
          currentSeasonOf(apiLeague) ?? 'none'
        })`,
      });
      continue;
    }

    try {
      const fixtures = await getFixtures(
        competition.provider_league_id,
        seasonYear,
      );

      for (const f of fixtures) {
        teams.set(f.teams.home.id, f.teams.home);
        teams.set(f.teams.away.id, f.teams.away);
        allFixtures.push({ competitionId: competition.id, fixture: f });
      }

      report.competitions.push({
        code: competition.code,
        season: seasonYear,
        fixtures: fixtures.length,
      });
    } catch (err) {
      report.competitions.push({
        code: competition.code,
        season: seasonYear,
        fixtures: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---- Teams ----
  if (teams.size > 0) {
    const { error } = await supabase.from('teams').upsert(
      Array.from(teams.values()).map((t) => ({
        provider_team_id: t.id,
        name: t.name,
        short_name: t.code,
        crest_url: t.logo,
      })),
      { onConflict: 'provider_team_id' },
    );
    if (error) throw new Error(`teams upsert: ${error.message}`);
    report.teamsUpserted = teams.size;
  }

  // ---- Team id lookup ----
  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, provider_team_id')
    .not('provider_team_id', 'is', null);

  const teamIdOf = new Map<number, string>();
  for (const t of teamRows ?? []) {
    if (t.provider_team_id !== null) teamIdOf.set(t.provider_team_id, t.id);
  }

  // ---- Gameweeks ----
  //
  // A gameweek is a block of fixtures, so it can only be worked out once the
  // fixtures are known. On a season that already has gameweeks the existing
  // boundaries are used and syncGameweeks re-cuts the un-drafted ones at the
  // end; on a fresh season they're created here so there is something to hang
  // the fixtures on at all.
  const { data: existing } = await supabase
    .from('gameweeks')
    .select('id, draft_closes_at')
    .eq('season_id', season.id)
    .order('draft_closes_at', { ascending: true });

  let boundaries = (existing ?? []).map((g) => ({
    id: g.id,
    from: new Date(g.draft_closes_at).getTime(),
  }));

  if (!boundaries.length) {
    const blocks = blocksFrom(allFixtures, (f) => new Date(f.fixture.fixture.date));
    const windows = draftWindows(blocks);
    const fresh: { id: string; from: number }[] = [];

    for (const [i, block] of blocks.entries()) {
      const { data: gw, error } = await supabase
        .from('gameweeks')
        .insert({
          season_id: season.id,
          number: i + 1,
          name: `Gameweek ${i + 1}`,
          draft_opens_at: windows[i].opensAt.toISOString(),
          draft_closes_at: windows[i].closesAt.toISOString(),
          first_kickoff_at: block.start.toISOString(),
        })
        .select('id')
        .single();
      if (error || !gw) throw new Error(`gameweeks: ${error?.message}`);
      fresh.push({ id: gw.id, from: block.start.getTime() });
    }
    boundaries = fresh;
  }

  report.gameweeks = boundaries.length;

  /** The block a kickoff falls in: the last one that had started by then. */
  const gameweekFor = (kickoff: Date): string | null => {
    if (!boundaries.length) return null;
    const t = kickoff.getTime();
    let chosen = boundaries[0].id;
    for (const b of boundaries) {
      if (b.from <= t) chosen = b.id;
      else break;
    }
    return chosen;
  };

  // ---- Fixtures ----
  const rows = allFixtures
    .map(({ competitionId, fixture }) => {
      const kickoff = new Date(fixture.fixture.date);
      const gameweekId = gameweekFor(kickoff);
      const homeId = teamIdOf.get(fixture.teams.home.id);
      const awayId = teamIdOf.get(fixture.teams.away.id);

      // A fixture outside the season window, or with a team we failed to
      // upsert, is skipped rather than guessed at.
      if (!gameweekId || !homeId || !awayId) return null;

      return {
        provider_fixture_id: fixture.fixture.id,
        gameweek_id: gameweekId,
        competition_id: competitionId,
        home_team_id: homeId,
        away_team_id: awayId,
        kickoff_at: kickoff.toISOString(),
        status: mapStatus(fixture.fixture.status.short),
        home_score: fixture.goals.home,
        away_score: fixture.goals.away,
        updated_at: new Date().toISOString(),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length > 0) {
    // Chunked — a full season across six competitions is a few thousand rows.
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await supabase
        .from('fixtures')
        .upsert(rows.slice(i, i + CHUNK), {
          onConflict: 'provider_fixture_id',
        });
      if (error) throw new Error(`fixtures upsert: ${error.message}`);
    }
    report.fixturesUpserted = rows.length;
  }

  // Absorb postponements and newly-scheduled cup rounds. Gameweeks that have
  // already started drafting are left exactly as they are.
  const sync = await syncGameweeks(supabase, season.id);
  report.kickoffsSynced = sync.recut;
  return report;
}
