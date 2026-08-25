import Link from 'next/link';

import { Crest } from '@/components/Crest';
import { FormGuide, FormGuideHeading } from '@/components/FormGuide';
import { JoinOpenLeagueForm } from '@/components/LeagueForms';
import { LockIcon } from '@/components/LockIcon';
import { TurnCountdown } from '@/components/TurnCountdown';
import { userAtTurn } from '@/lib/draft-order';
import { rank } from '@/lib/standings';
import { currentDraftFor } from '@/lib/current-draft';
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
      <p className="numeric mt-1 text-4xl leading-none">
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
    .select('division_id, league_id, divisions(name, tier), leagues(name, is_open, division_size)')
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
              : "You're not in a group yet"}
          </h2>
          <p className="mt-2 max-w-lg text-grey-700">
            {leagueCount
              ? 'You’ve joined a group, but the owner hasn’t split everyone into divisions yet. Drafting happens inside a division, so nothing starts until that’s done.'
              : 'Got a join code from a mate? Enter it on the group page. If not, take a place in the open league — we’ll put you in a division of three and you can start drafting.'}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {leagueCount ? (
              <Link href="/leagues" className="btn btn-lime">
                View your group
              </Link>
            ) : (
              <>
                <JoinOpenLeagueForm />
                <Link href="/leagues" className="btn btn-outline">
                  I have a join code
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Shared with the picks page, so the two can't tell the player different
  // stories about whether a draft is running.
  const [{ gameweek, draft }, { data: divisionMembers }, { data: leagueMembers }] =
    await Promise.all([
      currentDraftFor(supabase, membership.division_id),
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

  const [{ data: profiles }, { data: scores }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, display_name, avatar_color, avatar_url')
      .in('id', leagueIds.length ? leagueIds : [NOBODY]),
    supabase
      .from('gameweek_scores')
      .select('user_id, points, gameweek_id')
      .in('user_id', leagueIds.length ? leagueIds : [NOBODY]),
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

  // Only meaningful in the open league: a private league's owner arranges
  // divisions deliberately, so an incomplete one there is their choice.
  const openDivisionSize = membership.leagues?.division_size ?? 3;
  const openSeatsLeft = membership.leagues?.is_open
    ? Math.max(0, openDivisionSize - divisionIds.length)
    : 0;

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
             home:teams!fixtures_home_team_id_fkey(name, crest_url),
             away:teams!fixtures_away_team_id_fkey(name, crest_url)
           )`,
        )
        .eq('draft_id', draft.id)
        .eq('user_id', user!.id)
        .order('pick_number')
    : { data: null };

  type TeamRow = { name: string; crest_url: string | null };
  type PickRow = {
    id: string;
    predicted_outcome: 'HOME' | 'DRAW' | 'AWAY';
    is_auto_pick: boolean;
    fixtures: {
      kickoff_at: string;
      home: TeamRow | TeamRow[];
      away: TeamRow | TeamRow[];
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

        {/* An open division that hasn't filled reads as "1st of 1", which
            looks like a broken table rather than a division still forming.
            Say which it is. */}
        {openSeatsLeft > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-grey-300 bg-surface px-3 py-2 text-sm text-grey-700">
            <LockIcon open className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Your division is still filling &mdash; {divisionIds.length} of{' '}
              {openDivisionSize} players. You can draft now, but fixtures
              won&rsquo;t start going off the board until{' '}
              {openSeatsLeft === 1 ? 'one more player joins' : `${openSeatsLeft} more players join`}.
            </span>
          </p>
        )}
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
              ? 'The season has no more gameweeks scheduled.'
              : !draft
                ? `Picks open ${new Date(gameweek.draft_opens_at).toLocaleString(
                    'en-GB',
                    {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Europe/London',
                    },
                  )} — your division's draft starts automatically.`
                : `Your division has finished drafting gameweek ${gameweek.number}. Points land as results come in.`}
          </p>
        </section>
      )}

      {isMyTurn && (
        <div>
          <Link href="/draft" className="btn btn-hot">
            <LockIcon className="h-4 w-4" />
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
                const homeTeam = one(p.fixtures.home);
                const awayTeam = one(p.fixtures.away);
                const home = homeTeam.name;
                const away = awayTeam.name;
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
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <Crest url={homeTeam.crest_url} className="h-4 w-4" />
                      <span className="truncate">{home}</span>
                      <span className="text-grey-400">v</span>
                      <Crest url={awayTeam.crest_url} className="h-4 w-4" />
                      <span className="truncate">{away}</span>
                    </span>
                    <span className="flex items-center gap-1.5 font-medium">
                      {/* A called draw has no single club to badge. */}
                      <Crest
                        url={
                          p.predicted_outcome === 'HOME'
                            ? homeTeam.crest_url
                            : p.predicted_outcome === 'AWAY'
                              ? awayTeam.crest_url
                              : null
                        }
                        className="h-4 w-4"
                      />
                      {called}
                    </span>
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
                    className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-on-accent"
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
