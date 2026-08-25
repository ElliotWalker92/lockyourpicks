import type { SupabaseClient } from '@supabase/supabase-js';

import { getStandings, type ApiStandingRow } from '@/lib/api-football';
import type { Database } from '@/lib/types';

export type StandingsReport = {
  season: string;
  competitions: { code: string; rows: number; note?: string }[];
  rowsUpserted: number;
  errors: string[];
};

/**
 * Pull the real league tables.
 *
 * Only the league competitions have one — the cups are knockouts and return
 * nothing, which is why this walks `is_cup = false` rather than every active
 * competition. Four calls a run, so it can be scheduled as often as is
 * useful without troubling the rate limit.
 *
 * A competition that fails is recorded and skipped rather than aborting the
 * run: one league's table being unavailable is no reason to leave the other
 * three stale.
 */
export async function ingestStandings(
  supabase: SupabaseClient<Database>,
): Promise<StandingsReport> {
  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .select('id, name, starts_on')
    .eq('is_active', true)
    .single();

  if (seasonError || !season) {
    throw new Error('No active season.');
  }

  // Season years are named by their starting year: 2026/27 is season 2026.
  const seasonYear = new Date(season.starts_on).getUTCFullYear();

  const { data: competitions } = await supabase
    .from('competitions')
    .select('id, code, provider_league_id')
    .eq('is_active', true)
    .eq('is_cup', false)
    .order('tier');

  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, provider_team_id')
    .not('provider_team_id', 'is', null);

  const teamIdOf = new Map<number, string>();
  for (const t of teamRows ?? []) {
    if (t.provider_team_id !== null) teamIdOf.set(t.provider_team_id, t.id);
  }

  const report: StandingsReport = {
    season: season.name,
    competitions: [],
    rowsUpserted: 0,
    errors: [],
  };

  for (const competition of competitions ?? []) {
    if (competition.provider_league_id === null) continue;

    try {
      const table = await getStandings(
        competition.provider_league_id,
        seasonYear,
      );

      if (!table.length) {
        report.competitions.push({
          code: competition.code,
          rows: 0,
          note: 'no table published yet',
        });
        continue;
      }

      const rows = table
        .map((row) => toRow(row, competition.id, season.id, teamIdOf))
        .filter((r): r is NonNullable<typeof r> => r !== null);

      const missing = table.length - rows.length;

      const { error } = await supabase
        .from('standings')
        .upsert(rows, { onConflict: 'competition_id,season_id,team_id' });

      if (error) throw new Error(error.message);

      // Teams that dropped out of the table — relegated between seasons, or
      // a provider id we never stored — would otherwise linger at their old
      // position for ever.
      const keep = rows.map((r) => r.team_id);
      await supabase
        .from('standings')
        .delete()
        .eq('competition_id', competition.id)
        .eq('season_id', season.id)
        .not('team_id', 'in', `(${keep.join(',')})`);

      report.rowsUpserted += rows.length;
      report.competitions.push({
        code: competition.code,
        rows: rows.length,
        note: missing ? `${missing} team(s) not matched` : undefined,
      });
    } catch (err) {
      report.errors.push(
        `${competition.code}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return report;
}

function toRow(
  row: ApiStandingRow,
  competitionId: string,
  seasonId: string,
  teamIdOf: Map<number, string>,
) {
  const teamId = teamIdOf.get(row.team.id);
  if (!teamId) return null;

  return {
    competition_id: competitionId,
    season_id: seasonId,
    team_id: teamId,
    rank: row.rank,
    points: row.points,
    goals_diff: row.goalsDiff,

    played: row.all.played,
    win: row.all.win,
    draw: row.all.draw,
    lose: row.all.lose,
    goals_for: row.all.goals.for,
    goals_against: row.all.goals.against,

    home_played: row.home.played,
    home_win: row.home.win,
    home_draw: row.home.draw,
    home_lose: row.home.lose,
    home_goals_for: row.home.goals.for,
    home_goals_against: row.home.goals.against,

    away_played: row.away.played,
    away_win: row.away.win,
    away_draw: row.away.draw,
    away_lose: row.away.lose,
    away_goals_for: row.away.goals.for,
    away_goals_against: row.away.goals.against,

    form: row.form,
    status: row.status,
    description: row.description,
    updated_at: new Date().toISOString(),
  };
}
