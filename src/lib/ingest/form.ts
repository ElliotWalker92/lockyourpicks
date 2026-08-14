import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/types';

/** How many recent matches count as "form". */
export const FORM_LENGTH = 5;

export type TeamForm = Record<string, ('W' | 'D' | 'L')[]>;

/**
 * Recent results per team, oldest first, capped at FORM_LENGTH.
 *
 * Every finished fixture is read once and bucketed in memory rather than
 * running a query per team — a gameweek has ~70 distinct teams, and 70 round
 * trips to build one panel is not a trade worth making.
 */
export async function loadTeamForm(
  supabase: SupabaseClient<Database>,
): Promise<TeamForm> {
  const rows: {
    home_team_id: string;
    away_team_id: string;
    result: 'HOME' | 'DRAW' | 'AWAY' | null;
    kickoff_at: string;
  }[] = [];

  for (let offset = 0; offset < 5000; offset += 1000) {
    const { data } = await supabase
      .from('fixtures')
      .select('home_team_id, away_team_id, result, kickoff_at')
      .eq('status', 'finished')
      .not('result', 'is', null)
      .order('kickoff_at', { ascending: true })
      .range(offset, offset + 999);
    if (!data?.length) break;
    rows.push(
      ...(data as unknown as {
        home_team_id: string;
        away_team_id: string;
        result: 'HOME' | 'DRAW' | 'AWAY' | null;
        kickoff_at: string;
      }[]),
    );
    if (data.length < 1000) break;
  }

  const form: TeamForm = {};
  const push = (teamId: string, r: 'W' | 'D' | 'L') => {
    (form[teamId] ??= []).push(r);
    // Keep the tail — these arrive oldest first, so drop from the front.
    if (form[teamId].length > FORM_LENGTH) form[teamId].shift();
  };

  for (const f of rows) {
    if (f.result === 'DRAW') {
      push(f.home_team_id, 'D');
      push(f.away_team_id, 'D');
    } else if (f.result === 'HOME') {
      push(f.home_team_id, 'W');
      push(f.away_team_id, 'L');
    } else if (f.result === 'AWAY') {
      push(f.home_team_id, 'L');
      push(f.away_team_id, 'W');
    }
  }

  return form;
}

export type CrowdCounts = Record<
  string,
  { home: number; draw: number; away: number }
>;

/**
 * How every division has called each fixture this gameweek.
 *
 * Deliberately counts across the whole gameweek rather than just your league:
 * exclusivity caps a fixture at one pick per division, so a single league
 * yields a sample of at most a handful. Widening it is the only way the crowd
 * layer carries any signal at all — and the sample size is surfaced so nobody
 * mistakes three picks for a consensus.
 */
export async function loadCrowdCounts(
  supabase: SupabaseClient<Database>,
  gameweekId: string,
): Promise<CrowdCounts> {
  const { data: drafts } = await supabase
    .from('drafts')
    .select('id')
    .eq('gameweek_id', gameweekId);

  const draftIds = (drafts ?? []).map((d) => d.id);
  if (!draftIds.length) return {};

  const { data: picks } = await supabase
    .from('picks')
    .select('fixture_id, predicted_outcome')
    .in('draft_id', draftIds);

  const counts: CrowdCounts = {};
  for (const p of picks ?? []) {
    const c = (counts[p.fixture_id] ??= { home: 0, draw: 0, away: 0 });
    if (p.predicted_outcome === 'HOME') c.home++;
    else if (p.predicted_outcome === 'DRAW') c.draw++;
    else c.away++;
  }
  return counts;
}
