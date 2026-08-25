import Link from 'next/link';

import { LockIcon } from '@/components/LockIcon';
import { TableScopeToggle } from '@/components/TableScopeToggle';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Global leaderboard' };

const PAGE_SIZE = 100;

function initialsOf(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  if (w.length === 1) return w[0].charAt(0).toUpperCase();
  return (w[0].charAt(0) + w[w.length - 1].charAt(0)).toUpperCase();
}

type StandingRow = {
  user_id: string | null;
  points: number | null;
  gameweeks_played: number | null;
  correct_count: number | null;
  position: number | null;
};

type PlayerRow = {
  id: string;
  display_name: string | null;
  avatar_color: string | null;
  avatar_url: string | null;
};

function Row({
  row,
  player,
  highlight,
}: {
  row: StandingRow;
  player: PlayerRow | null;
  highlight: boolean;
}) {
  const name = player?.display_name ?? 'Player';
  return (
    <li
      className={`flex items-center gap-3 border-b border-grey-100 px-4 py-3 last:border-0 ${
        highlight ? 'bg-hot/5 font-semibold' : ''
      }`}
    >
      <span className="numeric w-8 shrink-0 text-lg text-grey-400">
        {row.position}
      </span>

      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-ink"
        style={{ background: player?.avatar_color ?? '#c8f135' }}
      >
        {player?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={player.avatar_url}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          initialsOf(name)
        )}
      </span>

      <span className="min-w-0 flex-1 truncate">{name}</span>

      <span className="hidden w-24 shrink-0 text-right text-sm text-grey-500 tabular-nums sm:block">
        {row.gameweeks_played} gw
      </span>

      <span className="numeric w-12 shrink-0 text-right text-lg">
        {row.points}
      </span>
    </li>
  );
}

export default async function LeaderboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: season } = await supabase
    .from('seasons')
    .select('id, name')
    .eq('is_active', true)
    .maybeSingle();

  if (!season) {
    return (
      <div className="card p-6">
        <h1 className="display-md">No active season</h1>
        <p className="mt-2 text-grey-700">
          The leaderboard appears once a season is running.
        </p>
      </div>
    );
  }

  const { data: rows } = await supabase
    .from('global_standings')
    .select('user_id, points, gameweeks_played, correct_count, position')
    .eq('season_id', season.id)
    .order('position', { ascending: true })
    .limit(PAGE_SIZE);

  const standings = rows ?? [];

  const { data: players } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_color, avatar_url')
    .in(
      'id',
      standings.map((r) => r.user_id).filter((id): id is string => Boolean(id)),
    );

  const playerById = new Map((players ?? []).map((p) => [p.id, p]));

  // Where the signed-in player sits, even if they're below the cut. Showing a
  // top-100 that silently omits the reader is the one thing a leaderboard
  // must not do.
  const inTopPage = standings.some((r) => r.user_id === user!.id);
  const myRow = inTopPage
    ? null
    : (
        await supabase
          .from('global_standings')
          .select('user_id, points, gameweeks_played, correct_count, position')
          .eq('season_id', season.id)
          .eq('user_id', user!.id)
          .maybeSingle()
      ).data;

  if (!standings.length) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <p className="label">{season.name}</p>
          <h1 className="display-lg mt-1">Global leaderboard</h1>
          <div className="mt-4">
            <TableScopeToggle scope="global" />
          </div>
        </div>
        <div className="card p-6">
          <h2 className="display-md">Nothing scored yet</h2>
          <p className="mt-2 max-w-lg text-grey-700">
            Every player in every league appears here once the first gameweek
            has been settled.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="label">{season.name}</p>
        <h1 className="display-lg mt-1">Global leaderboard</h1>
        <p className="mt-2 max-w-xl text-grey-700">
          Every player, every group, one table. You each get three picks a
          week worth a point apiece &mdash; so the totals compare, even though
          no two of you were choosing from the same board.
        </p>
        <div className="mt-4">
          <TableScopeToggle scope="global" />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-grey-300 px-4 py-3">
          <LockIcon className="h-3 w-3" />
          <span className="label flex-1">
            Top {Math.min(PAGE_SIZE, standings.length)}
          </span>
          <span className="hidden w-24 text-right text-xs text-grey-500 sm:block">
            played
          </span>
          <span className="w-12 text-right text-xs text-grey-500">pts</span>
        </div>

        <ul>
          {standings.map((row) => (
            <Row
              key={row.user_id}
              row={row}
              player={row.user_id ? (playerById.get(row.user_id) ?? null) : null}
              highlight={row.user_id === user!.id}
            />
          ))}
        </ul>

        {myRow && (
          <div className="border-t-2 border-grey-300">
            <ul>
              <Row
                row={myRow}
                player={
                  myRow.user_id
                    ? (playerById.get(myRow.user_id) ?? null)
                    : null
                }
                highlight
              />
            </ul>
          </div>
        )}
      </div>

      <p className="text-sm text-grey-500">
        Not playing yet?{' '}
        <Link href="/leagues" className="underline">
          Join a group or take a place in the open league.
        </Link>
      </p>
    </div>
  );
}
