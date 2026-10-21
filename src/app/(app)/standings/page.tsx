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
import { createClient } from '@/lib/supabase/server';
import { membershipsFor } from '@/lib/viewing';

export const metadata = { title: 'Leagues' };

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

/** W/D/L pills, most recent last — same key as the fixture model. */
function Form({ run }: { run: string | null }) {
  if (!run) return <span className="text-xs text-grey-400">&mdash;</span>;
  return (
    <span className="flex justify-end gap-1">
      {run
        .slice(-5)
        .split('')
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
       teams(name, short_name, crest_url)`,
    )
    .eq('competition_id', selected.id)
    .eq('season_id', season.id)
    .order('rank');

  const table = (rows ?? []).map((r) => {
    const team = Array.isArray(r.teams) ? r.teams[0] : r.teams;
    return { ...r, team };
  });

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
              { label: 'GF', from: 'md', value: (row) => row.goals_for },
              { label: 'GA', from: 'md', value: (row) => row.goals_against },
              {
                label: 'GD',
                value: (row) =>
                  row.goals_diff > 0 ? `+${row.goals_diff}` : row.goals_diff,
              },
              { label: 'Pts', emphasis: true, value: (row) => row.points },
              {
                label: 'Form',
                from: 'lg',
                value: (row) => <Form run={row.form} />,
              },
            ]}
          />

          <ZoneLegend zones={zonesPresent} />
        </>
      )}
    </div>
  );
}
