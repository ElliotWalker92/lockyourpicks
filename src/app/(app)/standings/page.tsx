import Link from 'next/link';

import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'League tables' };

type Zone = 'promotion' | 'playoff' | 'relegation' | null;

/**
 * Which zone a row sits in, from the provider's own wording.
 *
 * Play-offs are checked first: their description also begins "Promotion",
 * so testing for promotion first would paint the whole play-off pack as
 * going up.
 */
function zoneOf(description: string | null): Zone {
  if (!description) return null;
  if (/play off/i.test(description)) return 'playoff';
  if (/relegation/i.test(description)) return 'relegation';
  if (/promotion|champions league|europa/i.test(description))
    return 'promotion';
  return null;
}

const ZONE_BAR: Record<NonNullable<Zone>, string> = {
  promotion: 'bg-lime',
  playoff: 'bg-away',
  relegation: 'bg-loss',
};

const ZONE_LABEL: Record<NonNullable<Zone>, string> = {
  promotion: 'Promotion / Europe',
  playoff: 'Play-offs',
  relegation: 'Relegation',
};

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

  const { data: competitions } = await supabase
    .from('competitions')
    .select('id, code, name, tier')
    .eq('is_active', true)
    .eq('is_cup', false)
    .order('tier');

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
  ] as NonNullable<Zone>[];

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
                  ? 'border-ink bg-ink text-white'
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
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="label border-b border-grey-300 text-left">
                  <th className="py-3 pr-2 pl-4 font-bold">#</th>
                  <th className="py-3 font-bold">Team</th>
                  <th className="py-3 pl-3 text-right font-bold">P</th>
                  <th className="hidden py-3 pl-3 text-right font-bold sm:table-cell">
                    W
                  </th>
                  <th className="hidden py-3 pl-3 text-right font-bold sm:table-cell">
                    D
                  </th>
                  <th className="hidden py-3 pl-3 text-right font-bold sm:table-cell">
                    L
                  </th>
                  <th className="hidden py-3 pl-3 text-right font-bold md:table-cell">
                    GF
                  </th>
                  <th className="hidden py-3 pl-3 text-right font-bold md:table-cell">
                    GA
                  </th>
                  <th className="py-3 pl-3 text-right font-bold">GD</th>
                  <th className="py-3 pr-4 pl-3 text-right font-bold">Pts</th>
                  <th className="hidden py-3 pr-4 text-right font-bold lg:table-cell">
                    Form
                  </th>
                </tr>
              </thead>
              <tbody>
                {table.map((row) => {
                  const zone = zoneOf(row.description);
                  return (
                    <tr
                      key={row.rank}
                      title={row.description ?? undefined}
                      className="border-b border-grey-100 last:border-0"
                    >
                      <td className="relative py-2.5 pr-2 pl-4">
                        {/* Zone bar rather than a tinted row: it reads at a
                            glance without washing out the text. */}
                        {zone && (
                          <span
                            aria-hidden
                            className={`absolute top-0 bottom-0 left-0 w-1 ${ZONE_BAR[zone]}`}
                          />
                        )}
                        <span className="numeric text-grey-400">
                          {row.rank}
                        </span>
                      </td>

                      <td className="w-full max-w-0 py-2.5 pr-2">
                        <span className="flex items-center gap-2.5">
                          {row.team?.crest_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={row.team.crest_url}
                              alt=""
                              width={24}
                              height={24}
                              className="h-6 w-6 shrink-0 object-contain"
                              loading="lazy"
                            />
                          )}
                          <span
                            className="truncate font-medium"
                            title={row.team?.name ?? undefined}
                          >
                            {row.team?.name ?? 'Unknown'}
                          </span>
                        </span>
                      </td>

                      <td className="py-2.5 pl-3 text-right text-grey-500 tabular-nums">
                        {row.played}
                      </td>
                      <td className="hidden py-2.5 pl-3 text-right text-grey-500 tabular-nums sm:table-cell">
                        {row.win}
                      </td>
                      <td className="hidden py-2.5 pl-3 text-right text-grey-500 tabular-nums sm:table-cell">
                        {row.draw}
                      </td>
                      <td className="hidden py-2.5 pl-3 text-right text-grey-500 tabular-nums sm:table-cell">
                        {row.lose}
                      </td>
                      <td className="hidden py-2.5 pl-3 text-right text-grey-500 tabular-nums md:table-cell">
                        {row.goals_for}
                      </td>
                      <td className="hidden py-2.5 pl-3 text-right text-grey-500 tabular-nums md:table-cell">
                        {row.goals_against}
                      </td>
                      <td className="py-2.5 pl-3 text-right text-grey-700 tabular-nums">
                        {row.goals_diff > 0 ? `+${row.goals_diff}` : row.goals_diff}
                      </td>
                      <td className="numeric py-2.5 pr-4 pl-3 text-right text-base">
                        {row.points}
                      </td>
                      <td className="hidden py-2.5 pr-4 lg:table-cell">
                        <Form run={row.form} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {zonesPresent.length > 0 && (
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-grey-500">
              {zonesPresent.map((zone) => (
                <span key={zone} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={`h-3 w-1 rounded-full ${ZONE_BAR[zone]}`}
                  />
                  {ZONE_LABEL[zone]}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
