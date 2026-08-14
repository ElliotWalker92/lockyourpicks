import Link from 'next/link';

import { FormGuide, FormGuideHeading } from '@/components/FormGuide';
import { LockIcon } from '@/components/LockIcon';
import { TurnCountdown } from '@/components/TurnCountdown';
import { userAtTurn } from '@/lib/draft-order';
import { rank } from '@/lib/standings';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Dashboard' };

const NOBODY = '00000000-0000-0000-0000-000000000000';

function initialsOf(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  if (w.length === 1) return w[0].charAt(0).toUpperCase();
  return (w[0].charAt(0) + w[w.length - 1].charAt(0)).toUpperCase();
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Big number + caption, used for the three headline stats. */
function Stat({
  label,
  value,
  suffix,
  note,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  note?: string;
}) {
  return (
    <div className="card p-5">
      <p className="label">{label}</p>
      <p className="mt-1 font-serif text-4xl leading-none">
        {value}
        {suffix && (
          <span className="ml-1.5 text-base text-grey-500">{suffix}</span>
        )}
      </p>
      {note && <p className="mt-1.5 text-xs text-grey-500">{note}</p>}
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: season } = await supabase
    .from('seasons')
    .select('id, name')
    .eq('is_active', true)
    .maybeSingle();
  const seasonId = season?.id ?? NOBODY;

  const { data: membership } = await supabase
    .from('division_members')
    .select('division_id, league_id, divisions(name, tier), leagues(name)')
    .eq('user_id', user!.id)
    .eq('season_id', seasonId)
    .maybeSingle();

  // ---- Not in a division: say what's missing, not "0 points" ----
  if (!membership) {
    const { count: leagueCount } = await supabase
      .from('league_members')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user!.id);

    return (
      <div className="flex flex-col gap-6">
        <div>
          <p className="label">{season?.name ?? 'Season'}</p>
          <h1 className="display-lg mt-1">Welcome</h1>
        </div>
        <div className="card p-6">
          <h2 className="display-md">
            {leagueCount
              ? 'Waiting on your divisions'
              : "You're not in a league yet"}
          </h2>
          <p className="mt-2 max-w-lg text-grey-700">
            {leagueCount
              ? 'You’ve joined a league, but the owner hasn’t split everyone into divisions yet. Drafting happens inside a division, so nothing starts until that’s done.'
              : 'Ask whoever runs your league for their join code, then enter it on the leagues page. Or start one of your own.'}
          </p>
          <div className="mt-5">
            <Link href="/leagues" className="btn btn-lime">
              {leagueCount ? 'View your league' : 'Join or create a league'}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const nowIso = new Date().toISOString();

  const [{ data: gameweek }, { data: divisionMembers }, { data: leagueMembers }] =
    await Promise.all([
      supabase
        .from('gameweeks')
        .select('id, number, draft_closes_at')
        .lte('draft_opens_at', nowIso)
        .gt('draft_closes_at', nowIso)
        .order('number')
        .limit(1)
        .maybeSingle(),
      supabase
        .from('division_members')
        .select('user_id')
        .eq('division_id', membership.division_id),
      supabase
        .from('division_members')
        .select('user_id')
        .eq('league_id', membership.league_id)
        .eq('season_id', seasonId),
    ]);

  const divisionIds = (divisionMembers ?? []).map((m) => m.user_id);
  const leagueIds = (leagueMembers ?? []).map((m) => m.user_id);

  const { count: divisionCount } = await supabase
    .from('divisions')
    .select('*', { count: 'exact', head: true })
    .eq('league_id', membership.league_id)
    .eq('season_id', seasonId);

  const [{ data: profiles }, { data: scores }, { data: draft }] =
    await Promise.all([
      supabase
        .from('profiles')
        .select('id, display_name, avatar_color, avatar_url')
        .in('id', leagueIds.length ? leagueIds : [NOBODY]),
      supabase
        .from('gameweek_scores')
        .select('user_id, points, gameweek_id')
        .in('user_id', leagueIds.length ? leagueIds : [NOBODY]),
      gameweek
        ? supabase
            .from('drafts')
            .select(
              'id, status, pick_order, current_turn, picks_per_player, turn_expires_at',
            )
            .eq('division_id', membership.division_id)
            .eq('gameweek_id', gameweek.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const profileOf = (id: string) => profiles?.find((p) => p.id === id);
  const nameOf = (id: string) => profileOf(id)?.display_name ?? 'Player';

  const totalsFor = (ids: string[]) =>
    ids.map((id) => {
      const mine = (scores ?? []).filter((s) => s.user_id === id);
      return {
        userId: id,
        displayName: nameOf(id),
        points: mine.reduce((sum, s) => sum + (s.points ?? 0), 0),
        gameweeksPlayed: mine.length,
      };
    });

  const divisionTable = rank(totalsFor(divisionIds));
  const leagueTable = rank(totalsFor(leagueIds));

  // A table only carries meaning once something has been scored.
  const tableIsLive = divisionTable.some((r) => r.gameweeksPlayed > 0);

  const meDiv = divisionTable.find((r) => r.userId === user!.id);
  const meLeague = leagueTable.find((r) => r.userId === user!.id);

  // Recent gameweeks, oldest first, for the form guide.
  const { data: scoredWeeks } = await supabase
    .from('gameweeks')
    .select('id, number')
    .eq('status', 'settled')
    .order('number', { ascending: false })
    .limit(6);

  const recent = [...(scoredWeeks ?? [])].reverse();
  const formPlayers = divisionIds.map((id) => {
    const p = profileOf(id);
    const points = recent
      .map((w) => {
        const s = (scores ?? []).find(
          (x) => x.user_id === id && x.gameweek_id === w.id,
        );
        return s ? { gameweek: w.number, points: s.points ?? 0 } : null;
      })
      .filter((x): x is { gameweek: number; points: number } => x !== null);
    return {
      userId: id,
      name: nameOf(id),
      colour: p?.avatar_color ?? '#c8f135',
      avatarUrl: p?.avatar_url ?? null,
      points,
      total: points.reduce((sum, g) => sum + g.points, 0),
    };
  });
  formPlayers.sort((a, b) => b.total - a.total);

  const onTurn = draft ? userAtTurn(draft.pick_order, draft.current_turn) : null;
  const isMyTurn = draft?.status === 'active' && onTurn === user!.id;

  // My picks for the open gameweek.
  const { data: myPicks } = draft
    ? await supabase
        .from('picks')
        .select(
          `id, predicted_outcome, is_auto_pick,
           fixtures(
             kickoff_at,
             home:teams!fixtures_home_team_id_fkey(name),
             away:teams!fixtures_away_team_id_fkey(name)
           )`,
        )
        .eq('draft_id', draft.id)
        .eq('user_id', user!.id)
        .order('pick_number')
    : { data: null };

  type PickRow = {
    id: string;
    predicted_outcome: 'HOME' | 'DRAW' | 'AWAY';
    is_auto_pick: boolean;
    fixtures: {
      kickoff_at: string;
      home: { name: string } | { name: string }[];
      away: { name: string } | { name: string }[];
    };
  };
  const one = <T,>(v: T | T[]): T => (Array.isArray(v) ? v[0] : v);

  return (
    <div className="flex flex-col gap-8">
      {/* ---- Heading ---- */}
      <div>
        <p className="label">
          {membership.leagues?.name} &middot; {membership.divisions?.name}
          {season && <> &middot; {season.name}</>}
        </p>
        <h1 className="display-lg mt-1">
          {gameweek ? `Gameweek ${gameweek.number}` : 'No gameweek open'}
        </h1>
      </div>

      {/* ---- The clock ---- */}
      {draft && draft.status === 'active' ? (
        <TurnCountdown
          expiresAt={draft.turn_expires_at}
          isMyTurn={isMyTurn}
          onTurnName={onTurn ? nameOf(onTurn) : 'the next player'}
        />
      ) : (
        <section className="card p-6">
          <h2 className="display-md">
            {!gameweek
              ? 'Nothing to draft yet'
              : !draft
                ? 'Draft hasn’t opened'
                : 'All picked'}
          </h2>
          <p className="mt-2 text-grey-700">
            {!gameweek
              ? 'The next gameweek opens on Tuesday.'
              : !draft
                ? 'Your division’s draft opens automatically once the window starts.'
                : `Your division has finished drafting gameweek ${gameweek.number}. Points land as results come in.`}
          </p>
        </section>
      )}

      {isMyTurn && (
        <div>
          <Link href="/draft" className="btn btn-lime">
            Make your picks
          </Link>
        </div>
      )}

      {/* ---- Standings at a glance ---- */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label={membership.divisions?.name ?? 'Division'}
          value={meDiv ? ordinal(meDiv.position) : '—'}
          suffix={meDiv ? `of ${divisionTable.length}` : undefined}
          note={
            !tableIsLive
              ? 'Nothing scored yet'
              : meDiv?.tied
                ? 'Level on points'
                : 'Top goes up, bottom goes down'
          }
        />
        <Stat
          label="League overall"
          value={meLeague ? ordinal(meLeague.position) : '—'}
          suffix={meLeague ? `of ${leagueTable.length}` : undefined}
          note={`Across ${divisionCount} division${divisionCount === 1 ? '' : 's'}`}
        />
        <Stat
          label="Your points"
          value={meDiv?.points ?? 0}
          note={`${meDiv?.gameweeksPlayed ?? 0} gameweek${
            (meDiv?.gameweeksPlayed ?? 0) === 1 ? '' : 's'
          } scored`}
        />
      </div>

      {/* ---- Form guide ---- */}
      <section className="card p-5">
        <FormGuideHeading count={recent.length} />
        <FormGuide
          players={formPlayers}
          perfect={draft?.picks_per_player ?? 3}
          highlightUserId={user!.id}
        />
      </section>

      {/* ---- Picks and division table ---- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="label flex items-center gap-1.5">
              <LockIcon open={isMyTurn} className="h-3 w-3" />
              Your picks ({myPicks?.length ?? 0}/{draft?.picks_per_player ?? 3})
            </h2>
            {draft?.status === 'active' && (
              <Link
                href="/draft"
                className="text-sm text-grey-500 underline underline-offset-4 hover:text-ink"
              >
                {isMyTurn ? 'Edit' : 'View board'}
              </Link>
            )}
          </div>

          {!myPicks?.length ? (
            <p className="text-sm text-grey-500">
              {isMyTurn
                ? 'Nothing picked yet — you’re on the clock.'
                : 'Nothing picked yet.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(myPicks as unknown as PickRow[]).map((p) => {
                const home = one(p.fixtures.home).name;
                const away = one(p.fixtures.away).name;
                const called =
                  p.predicted_outcome === 'HOME'
                    ? home
                    : p.predicted_outcome === 'AWAY'
                      ? away
                      : 'Draw';
                return (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-grey-100 pb-2 text-sm last:border-0 last:pb-0"
                  >
                    <span className="flex-1">
                      {home} <span className="text-grey-400">v</span> {away}
                    </span>
                    <span className="font-medium">{called}</span>
                    {p.is_auto_pick && (
                      <span className="rounded bg-grey-100 px-1.5 py-0.5 text-xs text-grey-500">
                        auto
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="label">{membership.divisions?.name}</h2>
            <Link
              href="/table"
              className="text-sm text-grey-500 underline underline-offset-4 hover:text-ink"
            >
              Full table
            </Link>
          </div>

          <ul className="flex flex-col">
            {divisionTable.map((row, i) => {
              const p = profileOf(row.userId);
              const isLast = i === divisionTable.length - 1;
              return (
                <li
                  key={row.userId}
                  className={`flex items-center gap-3 border-b border-grey-100 py-2.5 text-sm last:border-0 ${
                    row.userId === user!.id ? 'font-medium' : ''
                  }`}
                >
                  <span className="w-4 text-grey-500 tabular-nums">
                    {row.position}
                  </span>
                  <span
                    aria-hidden
                    className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-ink"
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
                      initialsOf(row.displayName)
                    )}
                  </span>
                  <span className="flex-1">{row.displayName}</span>
                  {/* Only once the table means something. Before any gameweek
                      is scored everyone is level on zero, and marking the
                      arbitrary top row "up" asserts a promotion picture that
                      doesn't exist. */}
                  {tableIsLive && i === 0 && !row.tied && (
                    <span className="text-xs text-win">▲ up</span>
                  )}
                  {tableIsLive && isLast && !row.tied && (
                    <span className="text-xs text-loss">▼ down</span>
                  )}
                  <span className="w-8 text-right tabular-nums">
                    {row.points}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
