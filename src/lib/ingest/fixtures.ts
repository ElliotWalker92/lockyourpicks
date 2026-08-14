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
import { ensureGameweeks, syncGameweekKickoffs, weekStart } from './gameweeks';

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

  const gameweekCount = await ensureGameweeks(
    supabase,
    season.id,
    new Date(season.starts_on),
    new Date(season.ends_on),
  );

  const { data: gameweeks } = await supabase
    .from('gameweeks')
    .select('id, number, draft_opens_at')
    .eq('season_id', season.id)
    .order('number', { ascending: true });

  // Window start (a Tuesday, midnight UTC) → gameweek id.
  const windowIndex = new Map<number, string>();
  for (const gw of gameweeks ?? []) {
    windowIndex.set(new Date(gw.draft_opens_at).getTime(), gw.id);
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
    gameweeks: gameweekCount,
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

  // ---- Fixtures ----
  const rows = allFixtures
    .map(({ competitionId, fixture }) => {
      const kickoff = new Date(fixture.fixture.date);
      const gameweekId = windowIndex.get(weekStart(kickoff).getTime());
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

  report.kickoffsSynced = await syncGameweekKickoffs(supabase, season.id);
  return report;
}
