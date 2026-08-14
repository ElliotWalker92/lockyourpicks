import Link from 'next/link';

import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Results' };

const NOBODY = '00000000-0000-0000-0000-000000000000';

function initialsOf(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  if (w.length === 1) return w[0].charAt(0).toUpperCase();
  return (w[0].charAt(0) + w[w.length - 1].charAt(0)).toUpperCase();
}

type Team = { name: string } | { name: string }[];
const one = <T,>(v: T | T[]): T => (Array.isArray(v) ? v[0] : v);

/**
 * Past gameweeks: who picked what, and how it went.
 *
 * The spreadsheet showed every player's three picks side by side each week,
 * and that was most of the point — you want to see what everyone called, not
 * just the total it produced. Once a gameweek settled here the picks
 * disappeared from the interface entirely.
 *
 * Shows your own division. Other divisions draft from the same slate but
 * against different rivals, so mixing them together would compare picks that
 * were never in competition.
 */
export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ gw?: string }>;
}) {
  const { gw } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: season } = await supabase
    .from('seasons')
    .select('id')
    .eq('is_active', true)
    .maybeSingle();
  const seasonId = season?.id ?? NOBODY;

  const { data: membership } = await supabase
    .from('division_members')
    .select('division_id, divisions(name)')
    .eq('user_id', user!.id)
    .eq('season_id', seasonId)
    .maybeSingle();

  const heading = (
    <div>
      <p className="label">{membership?.divisions?.name ?? 'Results'}</p>
      <h1 className="display-lg mt-1">Results</h1>
    </div>
  );

  if (!membership) {
    return (
      <div className="flex flex-col gap-8">
        {heading}
        <div className="card p-6">
          <h2 className="display-md">Nothing to show yet</h2>
          <p className="mt-2 text-grey-700">
            You&rsquo;re not in a division, so there are no past picks. Start on
            the{' '}
            <Link href="/leagues" className="underline underline-offset-4">
              leagues page
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  // Gameweeks this division has actually drafted.
  const { data: drafts } = await supabase
    .from('drafts')
    .select('id, gameweek_id, gameweeks(number, status)')
    .eq('division_id', membership.division_id);

  const played = (drafts ?? [])
    .map((d) => ({
      draftId: d.id,
      gameweekId: d.gameweek_id,
      number: d.gameweeks?.number ?? 0,
      status: d.gameweeks?.status ?? 'upcoming',
    }))
    .sort((a, b) => b.number - a.number);

  if (!played.length) {
    return (
      <div className="flex flex-col gap-8">
        {heading}
        <div className="card p-6">
          <h2 className="display-md">No gameweeks drafted yet</h2>
          <p className="mt-2 text-grey-700">
            Once your division has drafted a gameweek, every pick shows up here.
          </p>
        </div>
      </div>
    );
  }

  const selected =
    played.find((p) => String(p.number) === gw) ?? played[0];

  const [{ data: picks }, { data: members }] = await Promise.all([
    supabase
      .from('picks')
      .select(
        `id, user_id, predicted_outcome, is_auto_pick, points_awarded, pick_number,
         fixtures(
           kickoff_at, home_score, away_score, result, status,
           home:teams!fixtures_home_team_id_fkey(name),
           away:teams!fixtures_away_team_id_fkey(name),
           competition:competitions(code)
         )`,
      )
      .eq('draft_id', selected.draftId)
      .order('pick_number'),
    supabase
      .from('division_members')
      .select('user_id')
      .eq('division_id', membership.division_id),
  ]);

  const memberIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_color, avatar_url')
    .in('id', memberIds.length ? memberIds : [NOBODY]);

  const profileOf = (id: string) => profiles?.find((p) => p.id === id);
  const nameOf = (id: string) => profileOf(id)?.display_name ?? 'Player';

  type Row = {
    id: string;
    user_id: string;
    predicted_outcome: 'HOME' | 'DRAW' | 'AWAY';
    is_auto_pick: boolean;
    points_awarded: number | null;
    fixtures: {
      kickoff_at: string;
      home_score: number | null;
      away_score: number | null;
      result: 'HOME' | 'DRAW' | 'AWAY' | null;
      status: string;
      home: Team;
      away: Team;
      competition: { code: string } | { code: string }[] | null;
    };
  };

  const rows = (picks ?? []) as unknown as Row[];
  const byPlayer = memberIds.map((id) => ({
    id,
    picks: rows.filter((r) => r.user_id === id),
    points: rows
      .filter((r) => r.user_id === id)
      .reduce((sum, r) => sum + (r.points_awarded ?? 0), 0),
  }));
  byPlayer.sort((a, b) => b.points - a.points);

  const anyScored = rows.some((r) => r.points_awarded !== null);

  return (
    <div className="flex flex-col gap-8">
      {heading}

      {/* ---- Gameweek picker ---- */}
      <div className="flex flex-wrap gap-2">
        {played.map((p) => (
          <Link
            key={p.number}
            href={`/results?gw=${p.number}`}
            className={`btn btn-sm ${
              p.number === selected.number ? 'btn-lime' : 'btn-outline'
            }`}
          >
            GW{p.number}
          </Link>
        ))}
      </div>

      {!anyScored && (
        <p className="card px-4 py-3 text-sm text-grey-700">
          Gameweek {selected.number} hasn&rsquo;t been scored yet &mdash; picks
          are shown, points land once the matches finish.
        </p>
      )}

      {/* ---- Each player's card ---- */}
      <div className="flex flex-col gap-5">
        {byPlayer.map((player) => {
          const p = profileOf(player.id);
          return (
            <section key={player.id} className="card overflow-hidden">
              <div className="flex items-center gap-3 border-b border-grey-300 px-5 py-3.5">
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-[11px] font-semibold text-ink"
                  style={{ background: p?.avatar_color ?? '#c8f135' }}
                >
                  {p?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.avatar_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initialsOf(nameOf(player.id))
                  )}
                </span>
                <h2 className="flex-1 font-medium">
                  {nameOf(player.id)}
                  {player.id === user!.id && (
                    <span className="ml-2 text-xs text-grey-500">you</span>
                  )}
                </h2>
                {anyScored && (
                  <span className="font-serif text-2xl">
                    {player.points}
                    <span className="ml-1 text-sm text-grey-500">
                      {player.points === 1 ? 'pt' : 'pts'}
                    </span>
                  </span>
                )}
              </div>

              <ul>
                {player.picks.length === 0 ? (
                  <li className="px-5 py-3 text-sm text-grey-500">
                    No picks made.
                  </li>
                ) : (
                  player.picks.map((row) => {
                    const home = one(row.fixtures.home).name;
                    const away = one(row.fixtures.away).name;
                    const comp = row.fixtures.competition
                      ? one(row.fixtures.competition).code
                      : null;
                    const called =
                      row.predicted_outcome === 'HOME'
                        ? home
                        : row.predicted_outcome === 'AWAY'
                          ? away
                          : 'Draw';
                    const finished = row.fixtures.status === 'finished';
                    const correct = row.points_awarded === 1;

                    return (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-grey-100 px-5 py-2.5 text-sm last:border-0"
                      >
                        <span className="min-w-44 flex-1">
                          {home} <span className="text-grey-400">v</span> {away}
                        </span>

                        {comp && (
                          <span className="rounded bg-grey-100 px-1.5 py-0.5 text-xs font-medium text-grey-500">
                            {comp}
                          </span>
                        )}

                        <span className="w-24 font-mono text-xs text-grey-500">
                          {finished
                            ? `${row.fixtures.home_score}–${row.fixtures.away_score}`
                            : row.fixtures.status}
                        </span>

                        <span className="w-32 font-medium">{called}</span>

                        {row.is_auto_pick && (
                          <span className="rounded bg-grey-100 px-1.5 py-0.5 text-xs text-grey-500">
                            auto
                          </span>
                        )}

                        {row.points_awarded !== null && (
                          <span
                            className={`w-6 text-right font-medium ${
                              correct ? 'text-win' : 'text-loss'
                            }`}
                            title={correct ? 'Correct' : 'Wrong'}
                          >
                            {correct ? '✓' : '✕'}
                          </span>
                        )}
                      </li>
                    );
                  })
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
