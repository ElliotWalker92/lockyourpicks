'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { lockInPicks, makePick, removePick } from '@/lib/actions/picks';
import { fullOrder, userAtTurn } from '@/lib/draft-order';
import { FixtureModel } from '@/components/FixtureModel';
import { FixtureLine, OutcomeChip, TeamName } from '@/components/Fixture';
import { LockIcon } from '@/components/LockIcon';
import {
  SharePicks,
  type SharePick,
  type SlipGroup,
} from '@/components/SharePicks';
import { createClient } from '@/lib/supabase/client';
import { formatDeadline } from '@/lib/turn-windows';
import { tallyOf, verdictOf } from '@/lib/scoring';
import type { TeamTable } from '@/lib/ingest/form';
import type { Outcome } from '@/lib/types';

/** Home lime, draw grey, away electric blue — same key as the model bars. */
const OUTCOME_BTN: Record<Outcome, string> = {
  HOME: 'btn-lime',
  DRAW: 'btn-draw',
  AWAY: 'btn-away',
};

export type BoardTeam = {
  id: string;
  name: string;
  crest_url: string | null;
  /** Null for a club nothing has been computed for — see migration 0040. */
  elo_rating: number | null;
  /** The rating rests on a seed we can't anchor — see migration 0047. */
  elo_provisional: boolean;
  form: ('W' | 'D' | 'L')[];
  /** League record split by venue. Absent for a side with no table. */
  table: TeamTable | null;
};

export type BoardFixture = {
  id: string;
  kickoff_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  result: Outcome | null;
  home: BoardTeam;
  away: BoardTeam;
  competition: { code: string; name: string; tier: number | null } | null;
};

/**
 * Kick-off, then club name.
 *
 * The names are there to break a tie rather than to sort on: a Saturday is
 * mostly 15:00, and with nothing to decide between them those thirty-odd
 * fixtures came back in whatever order Postgres chose — which read as
 * alphabetical, and could have come out differently on the next render.
 */
const byTimeThenName = (a: BoardFixture, b: BoardFixture) =>
  a.kickoff_at.localeCompare(b.kickoff_at) ||
  a.home.name.localeCompare(b.home.name) ||
  a.away.name.localeCompare(b.away.name);

const dayOf = (f: BoardFixture) =>
  new Date(f.kickoff_at).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/London',
  });

export type BoardPick = {
  id: string;
  user_id: string;
  fixture_id: string;
  predicted_outcome: Outcome;
  pick_number: number;
  is_auto_pick: boolean;
  /** null until the gameweek settles; 0 or 1 after. */
  points_awarded: number | null;
};

export type BoardPlayer = {
  id: string;
  display_name: string | null;
  /** Nullable in the schema — the column has a default but no NOT NULL. */
  avatar_color: string | null;
};

export type BoardDraft = {
  id: string;
  status: 'pending' | 'active' | 'complete';
  pick_order: string[];
  picks_per_player: number;
  current_turn: number;
  turn_expires_at: string | null;
};

/**
 * Ticking countdown.
 *
 * `now` starts null so the server render and the first client render agree on
 * showing nothing. Seeding it with `Date.now()` instead guarantees a hydration
 * mismatch: the server stamps one second into the HTML and the client renders
 * the next one a moment later.
 *
 * The first value arrives on the interval's first tick rather than immediately,
 * which costs a second of blank on an hours-long countdown and keeps the state
 * update out of the effect body.
 */
function useCountdown(target: string | null) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!target || now === null) return null;
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return 'expired';

  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function DraftBoard({
  draft,
  fixtures,
  picks,
  players,
  currentUserId,
  elsewhere,
  crowd,
  gameweekLabel,
  divisionName,
  now,
  schedule,
}: {
  draft: BoardDraft;
  fixtures: BoardFixture[];
  picks: BoardPick[];
  players: BoardPlayer[];
  currentUserId: string;
  /** Same fixture taken by another division — shown as context, not a signal. */
  elsewhere: Record<string, { division: string; called: string }[]>;
  /** How every division called each fixture this gameweek. */
  crowd: Record<string, { home: number; draw: number; away: number }>;
  /** For the shareable card — 'Gameweek 2'. */
  gameweekLabel: string;
  divisionName: string;
  /** Five minutes before the first kickoff, ISO. Nobody picks past it. */
  /**
   * One entry per seat, in pick order: when that turn ends, and whether
   * that is its real expiry or what it would get if the turns ahead ran
   * their full length. Null for a seat that has already picked.
   */
  schedule: ({ at: string; projected: boolean } | null)[];
  /**
   * Render time, from the server.
   *
   * The projection needs a clock, and taking one here would give a different
   * answer on the server than at hydration a moment later — a mismatch on
   * every deadline shown. One timestamp, agreed by both.
   */
  now: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [openModel, setOpenModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remaining = useCountdown(draft.turn_expires_at);

  // Any pick, by anyone, changes what's on the board — and in a draft you need
  // to see a rival's claim the moment it lands, not on next reload. Refreshing
  // the server component keeps one source of truth rather than reconciling a
  // second copy of draft state on the client.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`draft:${draft.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'picks',
          filter: `draft_id=eq.${draft.id}`,
        },
        () => router.refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'drafts',
          filter: `id=eq.${draft.id}`,
        },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [draft.id, router]);

  const playerOf = useMemo(() => {
    const map = new Map(players.map((p) => [p.id, p]));
    return (id: string) => map.get(id);
  }, [players]);

  const nameOf = (id: string) => playerOf(id)?.display_name ?? 'Player';

  /**
   * Colours are assigned by seat in the draft order, not read from the
   * profile. `avatar_color` carries the same default for everybody, which
   * makes the turn strip a row of identical dots — the one place where telling
   * players apart at a glance actually matters.
   */
  const colourOf = useMemo(() => {
    const palette = [
      '#c8f135',
      '#7dd3fc',
      '#fca5a5',
      '#fcd34d',
      '#c4b5fd',
      '#86efac',
      '#f9a8d4',
      '#fdba74',
    ];
    const seat = new Map(draft.pick_order.map((id, i) => [id, i]));
    return (id: string) => palette[(seat.get(id) ?? 0) % palette.length];
  }, [draft.pick_order]);

  /** "Test One" → TO · "Elliot" → E — so two Tests aren't both just "T". */
  const initialsOf = (id: string) => {
    const words = nameOf(id).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    return (
      words[0].charAt(0) + words[words.length - 1].charAt(0)
    ).toUpperCase();
  };

  const takenBy = useMemo(() => {
    const map = new Map<string, BoardPick>();
    for (const p of picks) map.set(p.fixture_id, p);
    return map;
  }, [picks]);

  const onTurn = userAtTurn(draft.pick_order, draft.current_turn);
  const isMyTurn = draft.status === 'active' && onTurn === currentUserId;
  const order = fullOrder(draft.pick_order);
  const myPicks = picks.filter((p) => p.user_id === currentUserId);

  // When each seat still to pick is due, worked out by the database and
  // handed over — see migration 0035. This used to be recomputed here from
  // a copy of the same arithmetic, which drifted out of step with it twice.
  const deadlines = useMemo(
    () =>
      order.map((_, seat) => {
        const row = schedule[seat];
        return row ? { at: new Date(row.at), projected: row.projected } : null;
      }),
    [order, schedule],
  );

  // The shared card has to say exactly what the list above it says, so the
  // call is derived once here rather than formatted again at the boundary.
  const toSharePick = (pick: BoardPick): SharePick[] => {
    const f = fixtures.find((x) => x.id === pick.fixture_id);
    if (!f) return [];
    return [
      {
        home: f.home.name,
        away: f.away.name,
        homeCrest: f.home.crest_url,
        awayCrest: f.away.crest_url,
        outcome: pick.predicted_outcome,
        called:
          pick.predicted_outcome === 'HOME'
            ? f.home.name
            : pick.predicted_outcome === 'AWAY'
              ? f.away.name
              : 'Draw',
        homeScore: f.home_score,
        awayScore: f.away_score,
        result: f.result,
        points: pick.points_awarded,
      },
    ];
  };

  const sharePicks: SharePick[] = myPicks
    .slice()
    .sort((a, b) => a.pick_number - b.pick_number)
    .flatMap(toSharePick);

  // The whole division's slip, in drafting order — the accumulator the group
  // actually talks about, rather than three separate lists of three.
  const expectedPicks = draft.pick_order.length * draft.picks_per_player;
  const everyoneIn = picks.length >= expectedPicks;

  const divisionSlip: SlipGroup[] = order.map((userId) => ({
    player: nameOf(userId),
    picks: picks
      .filter((p) => p.user_id === userId)
      .sort((a, b) => a.pick_number - b.pick_number)
      .flatMap(toSharePick),
  }));

  // Pickable: not already taken, not started. The list this comes from now
  // holds the whole gameweek, because the slip has to find its picks in it
  // long after their matches have kicked off.
  const available = fixtures.filter(
    (f) =>
      !takenBy.has(f.id) &&
      f.status === 'scheduled' &&
      new Date(f.kickoff_at).getTime() > new Date(now).getTime(),
  );

  function submit(fixtureId: string, outcome: Outcome) {
    setError(null);
    setSubmitting(fixtureId);
    startTransition(async () => {
      const result = await makePick(draft.id, fixtureId, outcome);
      if (!result.ok) setError(result.error);
      setSubmitting(null);
      router.refresh();
    });
  }

  function drop(pickId: string) {
    setError(null);
    startTransition(async () => {
      const result = await removePick(pickId);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  function lockIn() {
    setError(null);
    startTransition(async () => {
      const result = await lockInPicks(draft.id);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  /**
   * A block per league, each split into days.
   *
   * Grouping by day alone meant reading forty Saturday rows to find the one
   * League Two match you were after: on a normal gameweek nearly every
   * fixture is on the same afternoon, so a day heading barely divides
   * anything. A league is ten to twelve rows, it's what you already know
   * when you open the board, and its Friday and Monday games now come with
   * it instead of being filed under separate days further down the page.
   *
   * Everything is placed in one pass over a kick-off-ordered list, so each
   * league's days come out in date order and each day's fixtures in time
   * order without sorting a second time.
   */
  const byLeague = useMemo(() => {
    type Group = {
      code: string;
      name: string;
      tier: number;
      days: Map<string, BoardFixture[]>;
    };
    const leagues = new Map<string, Group>();

    for (const f of [...available].sort(byTimeThenName)) {
      const code = f.competition?.code ?? '';
      let group = leagues.get(code);
      if (!group) {
        group = {
          code,
          name: f.competition?.name ?? 'Other',
          // Cups carry no tier, and belong after the four divisions.
          tier: f.competition?.tier ?? 99,
          days: new Map(),
        };
        leagues.set(code, group);
      }

      const day = dayOf(f);
      if (!group.days.has(day)) group.days.set(day, []);
      group.days.get(day)!.push(f);
    }

    return [...leagues.values()]
      .sort((a, b) => a.tier - b.tier || a.code.localeCompare(b.code))
      .map((group) => ({
        code: group.code,
        name: group.name,
        count: [...group.days.values()].reduce((n, l) => n + l.length, 0),
        days: [...group.days.entries()],
      }));
  }, [available]);

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/London',
    });

  return (
    <div className="flex flex-col gap-8">
      {/* ---- Turn state ---- */}
      <section
        className={`card p-5 ${isMyTurn ? 'border-hot bg-hot/5' : ''}`}
      >
        {draft.status === 'complete' ? (
          <p className="font-medium">
            Draft complete — all picks are in for this gameweek.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="display-md">
                {isMyTurn ? (
                  <>
                    Your pick &mdash; <span className="font-semibold">choose one</span>
                  </>
                ) : (
                  <>Waiting on {onTurn ? nameOf(onTurn) : '—'}</>
                )}
              </h2>
              {remaining && (
                <p className="text-sm text-grey-500">
                  {remaining === 'expired' ? (
                    <span className="text-loss">
                      Turn expired &mdash; auto-pick due
                    </span>
                  ) : (
                    <>
                      Turn ends in{' '}
                      <span className="font-mono font-medium">{remaining}</span>
                    </>
                  )}
                </p>
              )}
            </div>

            <ol className="mt-4 flex flex-wrap gap-1.5">
              {order.map((userId, turn) => {
                const done = turn < draft.current_turn;
                const current = turn === draft.current_turn;
                return (
                  <li
                    key={turn}
                    title={`Pick ${turn + 1}: ${nameOf(userId)}`}
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold ${
                      current
                        ? 'ring-2 ring-ink ring-offset-1'
                        : ''
                    } ${done ? 'opacity-35' : ''}`}
                    style={{
                      background: colourOf(userId),
                      color: '#111',
                    }}
                  >
                    {initialsOf(userId)}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-loss/30 bg-loss/5 px-3 py-2 text-sm text-loss"
        >
          {error}
        </p>
      )}

      {/* ---- The slip ----
              One list, not three. "Your picks", "The week's slip" and "Gone"
              were the same nine picks sliced three ways: your own, then
              everyone's once the last player finished, then everyone else's
              struck through. So the same fixture appeared twice under two
              framings, the slip stayed hidden for most of the week, and a
              rival's pick read as a loss rather than as their call.

              This is the slip from the first pick, filling as the division
              drafts. Yours is the card that's lit. */}
      <section data-tour="slip">
        <h2 className="label mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <LockIcon open={!everyoneIn} className="h-3 w-3" />
          The slip
          <span className="font-normal normal-case tracking-normal text-grey-400">
            {picks.length}/{expectedPicks} in
          </span>
        </h2>
        <p className="mb-3 text-sm text-grey-700">
          {everyoneIn
            ? `Everyone's in — all ${expectedPicks} picks from ${divisionName}, in drafting order.`
            : `${divisionName}, in drafting order. Once a fixture is on here it's gone.`}
        </p>

        <ol className="flex flex-col gap-2">
          {order.map((userId, seat) => {
            const mine = userId === currentUserId;
            const theirs = picks
              .filter((p) => p.user_id === userId)
              .sort((a, b) => a.pick_number - b.pick_number);
            const owed = draft.picks_per_player - theirs.length;
            const picking = draft.status === 'active' && onTurn === userId;
            const due = deadlines[seat];

            // Same rule the dashboard and the results page use, from one place.
            const tally = tallyOf(
              theirs.map((p) => ({
                predicted_outcome: p.predicted_outcome,
                points_awarded: p.points_awarded,
                result: fixtures.find((f) => f.id === p.fixture_id)?.result,
              })),
            );

            return (
              <li
                key={userId}
                className={`overflow-hidden rounded-lg border ${
                  mine ? 'border-hot bg-hot/5' : 'border-grey-300 bg-card'
                }`}
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  <span
                    aria-hidden
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-on-accent"
                    style={{ background: colourOf(userId) }}
                  >
                    {initialsOf(userId)}
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium">
                    {nameOf(userId)}
                  </span>
                  {mine && (
                    <span className="shrink-0 text-xs text-grey-500">you</span>
                  )}
                  {picking && (
                    <span className="shrink-0 rounded-full bg-hot px-2 py-0.5 text-[10px] font-semibold text-white">
                      picking
                    </span>
                  )}

                  {/* Once anything has finished, what they've landed matters
                      more than how many they've taken. */}
                  {tally.decided > 0 ? (
                    <span className="ml-auto flex shrink-0 items-baseline gap-1.5">
                      <span className="numeric text-base">{tally.landed}</span>
                      <span className="text-xs text-grey-500">
                        {tally.settled
                          ? `pt${tally.landed === 1 ? '' : 's'}`
                          : `from ${tally.decided}`}
                      </span>
                    </span>
                  ) : (
                    <span className="ml-auto shrink-0 font-mono text-xs text-grey-500">
                      {theirs.length}/{draft.picks_per_player}
                    </span>
                  )}
                </div>

                <ul className="divide-y divide-grey-100 border-t border-grey-100">
                  {theirs.map((pick) => {
                    const f = fixtures.find((x) => x.id === pick.fixture_id);
                    if (!f) return null;
                    const verdict = verdictOf({
                      predicted_outcome: pick.predicted_outcome,
                      points_awarded: pick.points_awarded,
                      result: f.result,
                    });
                    const live = f.status === 'live';
                    return (
                      <li
                        key={pick.id}
                        className="flex items-center gap-2 px-3 py-2 text-sm"
                      >
                        <FixtureLine
                          home={f.home.name}
                          away={f.away.name}
                          homeCrest={f.home.crest_url}
                          awayCrest={f.away.crest_url}
                          outcome={pick.predicted_outcome}
                          className="flex-1 text-grey-700"
                        />
                        {pick.is_auto_pick && (
                          <span className="shrink-0 rounded bg-grey-100 px-1.5 py-0.5 text-[10px] text-grey-500">
                            auto
                          </span>
                        )}

                        {/* The score as it stands, hot while the game is on. */}
                        {f.home_score !== null && (
                          <span
                            className={`shrink-0 font-mono text-xs tabular-nums ${
                              live ? 'font-semibold text-hot' : 'text-grey-500'
                            }`}
                          >
                            {f.home_score}&ndash;{f.away_score}
                          </span>
                        )}

                        <OutcomeChip outcome={pick.predicted_outcome} />

                        {/* Only your own, and only while the turn is yours —
                            and never once a match has started. */}
                        {mine && isMyTurn && !verdict.decided && (
                          <button
                            type="button"
                            onClick={() => drop(pick.id)}
                            disabled={pending}
                            className="shrink-0 text-xs text-grey-500 underline underline-offset-2 transition hover:text-loss"
                          >
                            Remove
                          </button>
                        )}

                        {verdict.decided && (
                          <span
                            className={`w-4 shrink-0 text-right font-medium ${
                              verdict.correct ? 'text-win' : 'text-loss'
                            }`}
                            title={verdict.correct ? 'Correct' : 'Wrong'}
                          >
                            {verdict.correct ? '✓' : '✕'}
                          </span>
                        )}
                      </li>
                    );
                  })}

                  {owed > 0 && (
                    <li className="flex flex-wrap items-baseline gap-x-2 px-3 py-2 text-sm text-grey-400">
                      <span>
                        {mine && isMyTurn
                          ? `${owed} more to pick — choose below.`
                          : `${owed} still to come.`}
                      </span>

                      {/* The deadline belongs on the seat waiting on it. For
                          whoever is on the clock it's their real expiry; for
                          the rest it's what they'd get if everyone ahead used
                          their turn in full, and it says so rather than
                          presenting a guess as a promise. */}
                      {due && (
                        <span
                          className={
                            picking ? 'font-medium text-ink' : undefined
                          }
                        >
                          {due.projected ? 'about ' : 'by '}
                          {formatDeadline(due.at)}
                        </span>
                      )}
                    </li>
                  )}
                </ul>
              </li>
            );
          })}
        </ol>

        {isMyTurn && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={lockIn}
              disabled={pending || myPicks.length < draft.picks_per_player}
              data-tour="lock-in"
              className="btn btn-ink"
            >
              <LockIcon className="h-4 w-4" />
              {pending ? 'Working…' : 'Lock in my picks'}
            </button>
            <p className="text-sm text-grey-500">
              {myPicks.length < draft.picks_per_player
                ? `${draft.picks_per_player - myPicks.length} more to pick.`
                : 'Locking in passes the turn on — you can’t change them after.'}
            </p>
          </div>
        )}

        {/* One card at a time. Until the division is finished the only
            complete thing to send is your own set; after that it's the
            slip, which contains yours anyway. */}
        {everyoneIn ? (
          <SharePicks
            groups={divisionSlip}
            gameweek={gameweekLabel}
            subtitle={divisionName}
            locked
            heading="Send the slip"
            note={`All ${expectedPicks} picks on one card. Share sends the picture on a phone, or saves it to attach.`}
          />
        ) : (
          myPicks.length >= draft.picks_per_player && (
            <SharePicks
              groups={[{ player: nameOf(currentUserId), picks: sharePicks }]}
              gameweek={gameweekLabel}
              subtitle={`${nameOf(currentUserId)} · ${divisionName}`}
              locked={!isMyTurn}
            />
          )
        )}
      </section>

      {/* ---- Available ---- */}
      <section data-tour="available">
        <h2 className="label mb-3">
          Available ({available.length})
        </h2>

        {!isMyTurn && draft.status === 'active' && (
          <p className="mb-3 text-sm text-grey-500">
            You can look, but you can&rsquo;t pick until it&rsquo;s your turn.
          </p>
        )}

        <div className="flex flex-col gap-8">
          {byLeague.map((league) => (
            <div key={league.code}>
              {/* The heading carries the league, so the rows below it no
                  longer each need a competition badge. */}
              <h3 className="mb-3 flex items-baseline justify-between gap-3 border-b border-grey-300 pb-1.5">
                <span className="text-sm font-semibold text-ink">
                  {league.name}
                </span>
                <span className="shrink-0 text-xs font-medium text-grey-500">
                  {league.count} left
                </span>
              </h3>

              <div className="flex flex-col gap-4">
                {league.days.map(([day, dayFixtures]) => (
                <div key={day}>
                  <h4 className="mb-2 text-xs font-medium text-grey-500">
                    {day}
                  </h4>
                  <ul className="flex flex-col gap-1.5">
                    {dayFixtures.map((f) => {
                      const busy = submitting === f.id;
                      return (
                        <li
                          key={f.id}
                          className="overflow-hidden rounded-lg border border-grey-300 bg-card text-sm"
                        >
                         {/* On a phone the fixture takes the first line and the
                             three buttons take the second as equal thirds, so
                             they can't be squeezed however long the clubs are.
                             Once there's room it all sits on one line. */}
                         <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="w-11 shrink-0 font-mono text-xs text-grey-500">
                              {time(f.kickoff_at)}
                            </span>

                            <button
                              type="button"
                              onClick={() =>
                                setOpenModel(openModel === f.id ? null : f.id)
                              }
                              aria-expanded={openModel === f.id}
                              // The tour points at the first of these.
                              data-tour="fixture"
                              className="min-w-0 flex-1 text-left transition hover:text-lime-dark"
                              title="Show the model's read on this fixture"
                            >
                              <FixtureLine
                                home={f.home.name}
                                away={f.away.name}
                                homeCrest={f.home.crest_url}
                                awayCrest={f.away.crest_url}
                                crestClass="h-5 w-5"
                              />
                            </button>
                          </div>

                          {/* Outcome buttons sit with the fixture: one tap to
                              pick, rather than opening the row first and then
                              choosing. */}
                          <span
                            // The tour points at the first of these it
                            // finds, which is the top fixture on the board.
                            data-tour="pick-buttons"
                            className="grid grid-cols-3 gap-1.5 sm:flex sm:shrink-0"
                          >
                            {(
                              [
                                ['HOME', f.home.name],
                                ['DRAW', 'Draw'],
                                ['AWAY', f.away.name],
                              ] as [Outcome, string][]
                            ).map(([outcome, label]) => (
                              <button
                                key={outcome}
                                type="button"
                                disabled={!isMyTurn || pending}
                                onClick={() => submit(f.id, outcome)}
                                title={
                                  outcome === 'DRAW'
                                    ? 'Call it a draw'
                                    : `${label} to win`
                                }
                                className={`btn btn-sm ${OUTCOME_BTN[outcome]} ${
                                  busy ? 'opacity-60' : ''
                                }`}
                              >
                                {outcome === 'DRAW' ? (
                                  label
                                ) : (
                                  <TeamName name={label} />
                                )}
                              </button>
                            ))}
                          </span>
                         </div>

                          {openModel === f.id && (
                            <FixtureModel
                              home={{
                                name: f.home.name,
                                elo: f.home.elo_rating,
                                eloProvisional: f.home.elo_provisional,
                                form: f.home.form,
                                table: f.home.table,
                              }}
                              away={{
                                name: f.away.name,
                                elo: f.away.elo_rating,
                                eloProvisional: f.away.elo_provisional,
                                form: f.away.form,
                                table: f.away.table,
                              }}
                              crowdCounts={
                                crowd[f.id] ?? { home: 0, draw: 0, away: 0 }
                              }
                              otherPicks={elsewhere[f.id] ?? []}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
