import Link from 'next/link';

import { Crest } from '@/components/Crest';
import {
  Identity,
  StandingsTable,
  ZoneLegend,
  type Zone,
} from '@/components/StandingsTable';
import { activeLeagueId } from '@/lib/active-league';
import { leagueCompetitionIds } from '@/lib/competitions';
import { FORM_LENGTH } from '@/lib/ingest/form';
import { createClient } from '@/lib/supabase/server';
import { membershipsFor } from '@/lib/viewing';

export const metadata = { title: 'League tables' };

/** PostgREST types a to-one embed as an array when it can't prove otherwise. */
const one = <T,>(v: T | T[] | null): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : v;

/**
 * Which zone a row sits in, from the provider's own wording.
 *
 * Play-offs are checked first: their description also begins "Promotion",
 * so testing for promotion first would paint the whole play-off pack as
 * going up.
 */
function zoneOf(description: string | null): Zone | null {
  if (!description) return null;
  if (/play off/i.test(description)) return 'playoff';
  if (/relegation/i.test(description)) return 'relegation';
  if (/promotion|champions league|europa/i.test(description))
    return 'promotion';
  return null;
}

/**
 * W/D/L pills, most recent on the right — same key as the fixture model.
 *
 * The provider hands this over **newest first**: Manchester City's `LWWWW`
 * is a defeat last Saturday behind four wins, not four wins ending in one.
 * Verified against our own finished fixtures rather than taken from the
 * docs, because the column was being rendered straight through and read
 * backwards — the one direction nobody checks, since both ends are plausible.
 *
 * Reversed here rather than at ingest so the stored row stays exactly what
 * the provider said. `slice(0, FORM_LENGTH)` before the reverse, not after:
 * taking the tail would keep the five *oldest* of anything longer.
 */
function Form({ run }: { run: string | null }) {
  if (!run) return <span className="text-xs text-grey-400">&mdash;</span>;
  return (
    <span className="flex justify-end gap-1">
      {run
        .slice(0, FORM_LENGTH)
        .split('')
        .reverse()
        .map((r, i) => (
          <span
            key={i}
            title={r === 'W' ? 'Win' : r === 'D' ? 'Draw' : 'Loss'}
            className={`flex h-4 w-4 items-center justify-center rounded-sm text-[9px] font-bold ${
              r === 'W'
                ? 'bg-win/20 text-win'
                : r === 'D'
                  ? 'bg-grey-300 text-grey-700'
                  : 'bg-loss/20 text-loss'
            }`}
          >
            {r}
          </span>
        ))}
    </span>
  );
}

/** A club's next fixture: who, and whether they're at home. */
type NextGame = {
  opponent: string;
  crest: string | null;
  home: boolean;
  kickoff: string;
  competition: string;
};

/**
 * Who they play next.
 *
 * The crest alone can't say home or away, so it carries an H/A beside it —
 * and the title spells the whole thing out, because at this size a badge is
 * recognisable rather than readable.
 *
 * The fixture is the next one in *any* competition we follow, not the next
 * one in this table. Measured the week this was written: 13 of the 20
 * Premier League clubs had an EFL Cup tie before their next league game, so
 * a league-only column would have shown two thirds of the table a fixture
 * days later than the one they actually play and called it next. The note
 * under the table says so once, rather than every row carrying a
 * competition badge to explain itself.
 */
function Next({ game }: { game: NextGame | undefined }) {
  if (!game) return <span className="text-xs text-grey-400">&mdash;</span>;
  const when = new Date(game.kickoff).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  });
  return (
    <span
      className="flex items-center justify-end gap-1.5"
      title={`${game.home ? 'Home to' : 'Away at'} ${game.opponent} — ${game.competition}, ${when}`}
    >
      <Crest url={game.crest} className="h-5 w-5" />
      <span className="w-2 text-[10px] font-semibold text-grey-500">
        {game.home ? 'H' : 'A'}
      </span>
    </span>
  );
}

export default async function StandingsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const supabase = await createClient();

  const { data: season } = await supabase
    .from('seasons')
    .select('id, name')
    .eq('is_active', true)
    .maybeSingle();

  // Only the tables this reader's group actually plays. A competition on
  // offer that nobody has turned on has no rows in `standings` either — the
  // jobs don't fetch it (0042) — so listing it would offer an empty table.
  //
  // Falls open on an empty answer, same rule as the board: a reader in no
  // group yet, or a read that failed, gets the whole list rather than none.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const groups =
    user && season
      ? await membershipsFor(supabase, user.id, season.id)
      : [];
  const preferred = await activeLeagueId();
  const leagueId =
    groups.find((g) => g.leagueId === preferred)?.leagueId ??
    groups[0]?.leagueId ??
    null;
  const playing = leagueId
    ? await leagueCompetitionIds(supabase, leagueId)
    : [];

  const query = supabase
    .from('competitions')
    .select('id, code, name, tier')
    .eq('is_active', true)
    .eq('is_cup', false);
  const { data: competitions } = await (playing.length
    ? query.in('id', playing)
    : query
  ).order('tier');

  const all = competitions ?? [];
  const selected = all.find((x) => x.code === c) ?? all[0];

  if (!season || !selected) {
    return (
      <div className="card p-6">
        <h1 className="display-md">No tables yet</h1>
        <p className="mt-2 text-grey-700">
          League tables appear once the season&rsquo;s competitions are set up.
        </p>
      </div>
    );
  }

  const { data: rows } = await supabase
    .from('standings')
    .select(
      `rank, points, goals_diff, played, win, draw, lose,
       goals_for, goals_against, form, description,
       teams(id, name, short_name, crest_url)`,
    )
    .eq('competition_id', selected.id)
    .eq('season_id', season.id)
    .order('rank');

  const table = (rows ?? []).map((r) => {
    return { ...r, team: one(r.teams) };
  });

  // Each club's next fixture, in one read rather than one per row.
  //
  // Ordered by kick-off and taken first-wins, so whichever row mentions a
  // club earliest is its next game. `limit` is a backstop against reading
  // the rest of the season to answer a question about next week: 400 rows
  // is a few weeks across everything we follow, and the fallback for a club
  // that somehow isn't in them is an em dash rather than a wrong fixture.
  const teamIds = table.map((r) => r.team?.id).filter(Boolean) as string[];
  const { data: upcoming } = teamIds.length
    ? await supabase
        .from('fixtures')
        .select(
          `kickoff_at, home_team_id, away_team_id,
           home:teams!fixtures_home_team_id_fkey(name, crest_url),
           away:teams!fixtures_away_team_id_fkey(name, crest_url),
           competition:competitions(name)`,
        )
        .eq('status', 'scheduled')
        .gt('kickoff_at', new Date().toISOString())
        .or(
          `home_team_id.in.(${teamIds.map((id) => `"${id}"`).join(',')}),` +
            `away_team_id.in.(${teamIds.map((id) => `"${id}"`).join(',')})`,
        )
        .order('kickoff_at')
        .limit(400)
    : { data: [] };

  const nextGame = new Map<string, NextGame>();
  for (const fixture of upcoming ?? []) {
    const row = fixture as unknown as {
      kickoff_at: string;
      home_team_id: string;
      away_team_id: string;
      home: { name: string; crest_url: string | null };
      away: { name: string; crest_url: string | null };
      competition: { name: string } | null;
    };
    for (const atHome of [true, false]) {
      const teamId = atHome ? row.home_team_id : row.away_team_id;
      if (!teamIds.includes(teamId) || nextGame.has(teamId)) continue;
      const opponent = one(atHome ? row.away : row.home);
      if (!opponent) continue;
      nextGame.set(teamId, {
        opponent: opponent.name,
        crest: opponent.crest_url,
        home: atHome,
        kickoff: row.kickoff_at,
        competition: one(row.competition)?.name ?? 'a cup tie',
      });
    }
  }

  const zonesPresent = [
    ...new Set(table.map((r) => zoneOf(r.description)).filter(Boolean)),
  ] as Zone[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="label">{season.name}</p>
        <h1 className="display-lg mt-1">League tables</h1>
        <p className="mt-2 max-w-xl text-grey-700">
          The real thing &mdash; how the clubs you&rsquo;re drafting are
          actually doing.
        </p>
      </div>

      {/* ---- Competition switcher ---- */}
      <div className="flex flex-wrap gap-2">
        {all.map((competition) => {
          const active = competition.id === selected.id;
          return (
            <Link
              key={competition.id}
              href={`/standings?c=${competition.code}`}
              aria-current={active ? 'page' : undefined}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? 'border-panel bg-panel text-white'
                  : 'border-grey-300 text-grey-700 hover:border-ink hover:text-ink'
              }`}
            >
              {competition.name}
            </Link>
          );
        })}
      </div>

      {table.length === 0 ? (
        <div className="card p-6">
          <h2 className="display-md">Nothing published yet</h2>
          <p className="mt-2 text-grey-700">
            {selected.name} hasn&rsquo;t had a table published for this season
            yet. It appears once the opening round has been played.
          </p>
        </div>
      ) : (
        <>
          <StandingsTable
            rows={table}
            keyOf={(row) => String(row.rank)}
            rank={(row) => row.rank}
            zoneOf={(row) => zoneOf(row.description)}
            identityLabel="Team"
            identity={(row) => (
              <Identity
                badge={<Crest url={row.team?.crest_url} className="h-6 w-6" />}
                name={row.team?.name ?? 'Unknown'}
              />
            )}
            columns={[
              { label: 'P', value: (row) => row.played },
              { label: 'W', from: 'sm', value: (row) => row.win },
              { label: 'D', from: 'sm', value: (row) => row.draw },
              { label: 'L', from: 'sm', value: (row) => row.lose },
              { label: 'GF', from: 'lg', value: (row) => row.goals_for },
              { label: 'GA', from: 'lg', value: (row) => row.goals_against },
              {
                label: 'GD',
                value: (row) =>
                  row.goals_diff > 0 ? `+${row.goals_diff}` : row.goals_diff,
              },
              { label: 'Pts', emphasis: true, value: (row) => row.points },
              {
                label: 'Form',
                from: 'md',
                value: (row) => <Form run={row.form} />,
              },
              {
                label: 'Next',
                value: (row) => (
                  <Next game={nextGame.get(row.team?.id ?? '')} />
                ),
              },
            ]}
          />

          <div className="flex flex-col gap-2">
            <ZoneLegend zones={zonesPresent} />
            <p className="text-xs text-grey-500">
              Form reads left to right, oldest to most recent. Next is each
              club&rsquo;s very next fixture in any competition we follow, so
              it may be a cup tie &mdash; hover or long-press it for the
              details.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
