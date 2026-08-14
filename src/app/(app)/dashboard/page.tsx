import Link from 'next/link';

import { userAtTurn } from '@/lib/draft-order';
import { rank } from '@/lib/standings';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Dashboard' };

const NOBODY = '00000000-0000-0000-0000-000000000000';

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

  // ---- Not yet in a division: tell them what's missing, not "0 points" ----
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
            {leagueCount ? 'Waiting on your divisions' : "You're not in a league yet"}
          </h2>
          <p className="mt-2 max-w-lg text-grey-700">
            {leagueCount
              ? 'You’ve joined a league, but the owner hasn’t split everyone into divisions yet. Drafting happens inside a division, so nothing starts until that’s done.'
              : 'Ask whoever runs your league for their join code, then enter it on the leagues page. Or start a league of your own.'}
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

  // ---- In a division: the two things that matter are "is it my turn" and
  // ---- "where am I" ----
  const nowIso = new Date().toISOString();

  const [{ data: gameweek }, { data: divisionMembers }, { data: scores }] =
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
        .from('gameweek_scores')
        .select('user_id, points')
        .eq('division_id', membership.division_id),
    ]);

  const memberIds = (divisionMembers ?? []).map((m) => m.user_id);

  const [{ data: profiles }, { data: draft }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', memberIds.length ? memberIds : [NOBODY]),
    gameweek
      ? supabase
          .from('drafts')
          .select('id, status, pick_order, current_turn, picks_per_player')
          .eq('division_id', membership.division_id)
          .eq('gameweek_id', gameweek.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const nameOf = (id: string) =>
    profiles?.find((p) => p.id === id)?.display_name ?? 'Player';

  const table = rank(
    memberIds.map((id) => {
      const mine = (scores ?? []).filter((s) => s.user_id === id);
      return {
        userId: id,
        displayName: nameOf(id),
        points: mine.reduce((sum, s) => sum + (s.points ?? 0), 0),
        gameweeksPlayed: mine.length,
      };
    }),
  );

  const me = table.find((r) => r.userId === user!.id);
  const onTurn = draft ? userAtTurn(draft.pick_order, draft.current_turn) : null;
  const isMyTurn = draft?.status === 'active' && onTurn === user!.id;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="label">
          {membership.leagues?.name} &middot; {membership.divisions?.name}
        </p>
        <h1 className="display-lg mt-1">
          {isMyTurn ? (
            <>
              It&rsquo;s <span className="italic">your</span> pick.
            </>
          ) : (
            `Gameweek ${gameweek?.number ?? '—'}`
          )}
        </h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5">
          <p className="label">Your points</p>
          <p className="font-serif text-4xl">{me?.points ?? 0}</p>
        </div>
        <div className="card p-5">
          <p className="label">Division position</p>
          <p className="font-serif text-4xl">
            {me?.position ?? '—'}
            {me?.tied && <span className="text-grey-400">=</span>}
            <span className="ml-1 text-base text-grey-500">
              of {table.length}
            </span>
          </p>
        </div>
        <div className="card p-5">
          <p className="label">Gameweeks played</p>
          <p className="font-serif text-4xl">{me?.gameweeksPlayed ?? 0}</p>
        </div>
      </div>

      <div
        className={`card p-5 ${isMyTurn ? 'border-lime-dark bg-lime/10' : ''}`}
      >
        {!gameweek ? (
          <>
            <h2 className="display-md">No gameweek open</h2>
            <p className="mt-1.5 text-grey-700">
              Nothing to draft right now. The next one opens on Tuesday.
            </p>
          </>
        ) : !draft ? (
          <>
            <h2 className="display-md">Draft hasn&rsquo;t opened</h2>
            <p className="mt-1.5 text-grey-700">
              Gameweek {gameweek.number} is open but your division&rsquo;s draft
              hasn&rsquo;t started yet. It opens automatically.
            </p>
          </>
        ) : draft.status === 'complete' ? (
          <>
            <h2 className="display-md">All picked</h2>
            <p className="mt-1.5 text-grey-700">
              Your division has finished drafting gameweek {gameweek.number}.
              Points land as results come in.
            </p>
            <div className="mt-4">
              <Link href="/draft" className="btn btn-outline btn-sm">
                See the picks
              </Link>
            </div>
          </>
        ) : isMyTurn ? (
          <>
            <h2 className="display-md">You&rsquo;re up</h2>
            <p className="mt-1.5 text-grey-700">
              Pick a fixture before your turn runs out, or the clock picks for
              you.
            </p>
            <div className="mt-4">
              <Link href="/draft" className="btn btn-lime">
                Make your pick
              </Link>
            </div>
          </>
        ) : (
          <>
            <h2 className="display-md">
              Waiting on {onTurn ? nameOf(onTurn) : 'the next pick'}
            </h2>
            <p className="mt-1.5 text-grey-700">
              You&rsquo;ll be up shortly. Fixtures they take are gone for good.
            </p>
            <div className="mt-4">
              <Link href="/draft" className="btn btn-outline btn-sm">
                Watch the board
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
