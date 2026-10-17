import Link from 'next/link';

import { Identity, StandingsTable } from '@/components/StandingsTable';
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

type PlayerRow = {
  id: string;
  display_name: string | null;
  avatar_color: string | null;
  avatar_url: string | null;
};

function Avatar({ player, name }: { player: PlayerRow | null; name: string }) {
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-on-accent"
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
    .select('user_id, points, gameweeks_played, correct_count, position, league_name, leagues_played')
    .eq('season_id', season.id)
    .order('position', { ascending: true })
    .limit(PAGE_SIZE);

  const standings = rows ?? [];

  // The reader's own id goes in whether or not they made the cut. Without it
  // a player ranked below the top 100 was looked up in a map built only from
  // the top 100, missed, and shown on their own row as "Player".
  const { data: players } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_color, avatar_url')
    .in('id', [
      ...new Set([
        ...standings
          .map((r) => r.user_id)
          .filter((id): id is string => Boolean(id)),
        user!.id,
      ]),
    ]);

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
          .select('user_id, points, gameweeks_played, correct_count, position, league_name, leagues_played')
          .eq('season_id', season.id)
          .eq('user_id', user!.id)
          .maybeSingle()
      ).data;

  // One shape for both tables below — the top page and the reader's own row
  // are the same table cut in two places, so they render identically.
  type Row = (typeof standings)[number];

  const identity = (row: Row) => {
    const player = row.user_id ? (playerById.get(row.user_id) ?? null) : null;
    const name = player?.display_name ?? 'Player';
    return (
      <Identity
        badge={<Avatar player={player} name={name} />}
        name={name}
        // Only for the people it needs explaining to. Somebody in one group
        // doesn't need telling which group their points came from; somebody
        // in two would otherwise see a total lower than their own
        // arithmetic and no reason for it.
        note={
          (row.leagues_played ?? 1) > 1
            ? `best of ${row.leagues_played} — ${row.league_name}`
            : undefined
        }
      />
    );
  };

  const columns = [
    { label: 'P', from: 'sm' as const, value: (row: Row) => row.gameweeks_played },
    { label: 'Pts', emphasis: true, value: (row: Row) => row.points },
  ];

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
          Every player, every group, one table. Anyone playing in more than
          one group is counted on their strongest &mdash; a longer season
          isn&rsquo;t a better one.
        </p>
        <div className="mt-4">
          <TableScopeToggle scope="global" />
        </div>
      </div>

      <StandingsTable
        rows={standings}
        title={`Top ${Math.min(PAGE_SIZE, standings.length)}`}
        keyOf={(row) => row.user_id ?? String(row.position)}
        rank={(row) => row.position}
        identityLabel="Player"
        identity={identity}
        highlight={(row) => row.user_id === user!.id}
        columns={columns}
      />

      {/* Below the cut and still on the page. */}
      {myRow && (
        <StandingsTable
          rows={[myRow]}
          title="You"
          keyOf={(row) => row.user_id ?? 'me'}
          rank={(row) => row.position}
          identityLabel="Player"
          identity={identity}
          highlight={() => true}
          columns={columns}
        />
      )}

      <p className="text-sm text-grey-500">
        Not playing yet?{' '}
        <Link href="/leagues" className="underline">
          Join a group or take a place in the open league.
        </Link>
      </p>
    </div>
  );
}
