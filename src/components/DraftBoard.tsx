'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

import { lockInPicks, makePick, removePick } from '@/lib/actions/picks';
import { fullOrder, userAtTurn } from '@/lib/draft-order';
import { FixtureModel } from '@/components/FixtureModel';
import { FixtureLine, TeamName } from '@/components/Fixture';
import { LockIcon } from '@/components/LockIcon';
import { Slip, type SlipPick, type SlipPlayer } from '@/components/Slip';
import {
  SharePicks,
  type SharePick,
  type SlipGroup,
} from '@/components/SharePicks';
import { createClient } from '@/lib/supabase/client';
import { abbreviate } from '@/lib/team-codes';
import { formatDeadline } from '@/lib/turn-windows';
import { tallyOf } from '@/lib/scoring';
import type { TeamTable } from '@/lib/ingest/form';
import type { Outcome } from '@/lib/types';

/** Home lime, draw grey, away electric blue — same key as the model bars. */
const OUTCOME_BTN: Record<Outcome, string> = {
  HOME: 'btn-lime',
  DRAW: 'btn-draw',
  AWAY: 'btn-away',
};

/** The same key again, for the filled slots in the lock-in bar. */
const SLOT_FILLED: Record<Outcome, string> = {
  HOME: 'border-lime bg-lime text-on-accent',
  DRAW: 'border-grey-300 bg-grey-300 text-on-accent',
  AWAY: 'border-away bg-away text-white',
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
  roundLabel,
  closesAt,
  scopeToggle,
  roundStrip,
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
  /** 'Gameweek 21 · Division 1' — the header's first line. */
  roundLabel: string;
  /** When picking shuts for everyone, already formatted. */
  closesAt: string;
  /**
   * Rendered inside the header rather than above it.
   *
   * Both are server-rendered links the board has no business constructing,
   * and both answer "which round am I looking at" — so they belong in the
   * one header block with everything else that answers it, not as two more
   * bands of chrome stacked on top of the page.
   */
  scopeToggle: ReactNode;
  roundStrip: ReactNode;
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

  /**
   * Whether the pinned bar is showing your own three in full.
   *
   * A fixture leaves the board the moment somebody takes it, and on a phone
   * the slip sits below the board — so mid-turn the only record of what you
   * hold is three colour-coded chips in the bar. This opens them out into
   * the real rows, from wherever on the page you've got to.
   */
  const [slipOpen, setSlipOpen] = useState(false);

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
  const myPicks = picks
    .filter((p) => p.user_id === currentUserId)
    .sort((a, b) => a.pick_number - b.pick_number);
  const owed = draft.picks_per_player - myPicks.length;

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

  const mySeat = order.indexOf(currentUserId);
  const myDue = mySeat >= 0 ? deadlines[mySeat] : null;
  const turnsAhead =
    mySeat >= 0 && draft.status !== 'complete'
      ? Math.max(mySeat - draft.current_turn, 0)
      : 0;

  const fixtureOf = useMemo(() => {
    const map = new Map(fixtures.map((f) => [f.id, f]));
    return (id: string) => map.get(id);
  }, [fixtures]);

  // The shared card has to say exactly what the list above it says, so the
  // call is derived once here rather than formatted again at the boundary.
  const toSharePick = (pick: BoardPick): SharePick[] => {
    const f = fixtureOf(pick.fixture_id);
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

  const sharePicks: SharePick[] = myPicks.flatMap(toSharePick);

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
   * One block per league, kick-off ordered.
   *
   * It used to be league, then day, then fixtures — two levels of heading
   * over a list where nearly every row says the same thing anyway, since a
   * normal gameweek is one Saturday afternoon. The day moved into the
   * kick-off cell instead, where it costs nothing and sits with the time it
   * belongs to, and the second level of heading went.
   *
   * A league is ten to twelve rows, it's what you already know when you open
   * the board, and its Friday and Monday games now come with it rather than
   * being filed under separate days further down the page.
   */
  const byLeague = useMemo(() => {
    type Group = {
      code: string;
      name: string;
      tier: number;
      fixtures: BoardFixture[];
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
          fixtures: [],
        };
        leagues.set(code, group);
      }
      group.fixtures.push(f);
    }

    return [...leagues.values()].sort(
      (a, b) => a.tier - b.tier || a.code.localeCompare(b.code),
    );
  }, [available]);

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/London',
    });

  const dayShort = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', {
      weekday: 'short',
      timeZone: 'Europe/London',
    });

  const dayLong = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'Europe/London',
    });

  // ---- The header's own words ----
  const headline =
    draft.status === 'complete'
      ? 'All picked'
      : isMyTurn
        ? owed > 0
          ? `Your turn — take ${owed}`
          : 'Your turn — lock in'
        : `${onTurn ? nameOf(onTurn) : 'Someone'} is picking`;

  const standing = (() => {
    if (draft.status === 'complete') {
      return 'Everyone in this division is in. Points land as results come in.';
    }
    if (isMyTurn) {
      return owed > 0
        ? `Pick ${owed} from the board, then lock in. Once a fixture is taken in ${divisionName} nobody else can have it.`
        : 'Locking in passes the turn on — you can’t change them after.';
    }
    if (owed === 0) {
      return `You’re all in. ${onTurn ? nameOf(onTurn) : 'The next player'} is on the clock.`;
    }
    const due = myDue
      ? `${myDue.projected ? 'about ' : 'by '}${formatDeadline(myDue.at)}`
      : null;
    if (turnsAhead <= 1) {
      return `You’re next${due ? ` — ${due}` : ''}. Have a look at the board while you wait.`;
    }
    return `${turnsAhead} turns ahead of you${due ? ` — you’re up ${due}` : ''}. Have a look at the board while you wait.`;
  })();

  // ---- The slip, through the one component that draws them all ----
  const slipPlayers: SlipPlayer[] = order.map((userId, seat) => {
    const mine = userId === currentUserId;
    const theirs = picks
      .filter((p) => p.user_id === userId)
      .sort((a, b) => a.pick_number - b.pick_number);
    const theirOwed = draft.picks_per_player - theirs.length;
    const picking = draft.status === 'active' && onTurn === userId;
    const due = deadlines[seat];

    const slipPicks: SlipPick[] = theirs.flatMap((pick) => {
      const f = fixtureOf(pick.fixture_id);
      if (!f) return [];
      return [
        {
          key: pick.id,
          home: f.home.name,
          away: f.away.name,
          homeCrest: f.home.crest_url,
          awayCrest: f.away.crest_url,
          outcome: pick.predicted_outcome,
          homeScore: f.home_score,
          awayScore: f.away_score,
          result: f.result,
          status: f.status,
          points: pick.points_awarded,
          isAuto: pick.is_auto_pick,
          // Only your own, and only while the turn is yours. Slip itself
          // withholds it once a match has been decided.
          onRemove:
            mine && isMyTurn ? () => drop(pick.id) : undefined,
          removeDisabled: pending,
        },
      ];
    });

    return {
      key: userId,
      name: nameOf(userId),
      colour: colourOf(userId),
      mine,
      picking,
      // Same rule the dashboard and the results page use, from one place.
      tally: tallyOf(
        theirs.map((p) => ({
          predicted_outcome: p.predicted_outcome,
          points_awarded: p.points_awarded,
          result: fixtureOf(p.fixture_id)?.result,
        })),
      ),
      perPlayer: draft.picks_per_player,
      picks: slipPicks,
      waiting:
        theirOwed > 0 ? (
          <>
            <span>
              {mine && isMyTurn
                ? `${theirOwed} more to take — choose from the board.`
                : `${theirOwed} still to come.`}
            </span>
            {/* The deadline belongs on the seat waiting on it. For whoever
                is on the clock it's their real expiry; for the rest it's
                what they'd get if everyone ahead used their turn in full,
                and it says so rather than presenting a guess as a promise. */}
            {due && (
              <span className={picking ? 'font-medium text-ink' : undefined}>
                {due.projected ? 'about ' : 'by '}
                {formatDeadline(due.at)}
              </span>
            )}
          </>
        ) : undefined,
    };
  });

  /** Your own card of the slip, for the bar to open out. */
  const mySlip = slipPlayers.find((player) => player.mine);

  /**
   * Your three slots, in one piece drawn twice.
   *
   * On a phone they sit in a bar pinned to the bottom of the screen; on a
   * desktop they sit at the top of the sticky rail. Same markup either way,
   * because the problem is the same at both widths: Lock in used to sit
   * above the board, so taking three fixtures left it off-screen behind you
   * with nothing to say it was there.
   *
   * What a chip *does* differs, and that's why this takes a callback rather
   * than a flag. In the rail the slip is already open beside it, so a tap
   * drops the pick. In the bar it isn't, so the chips are inert and the tap
   * belongs to the disclosure around them.
   */
  const slotsList = (onPick?: (pickId: string) => void) => (
    <div className="flex shrink-0 gap-1.5">
      {Array.from({ length: draft.picks_per_player }, (_, i) => {
        const pick = myPicks[i];
        if (!pick) {
          return (
            <span
              key={`empty-${i}`}
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-md border-[1.5px] border-dashed border-grey-300 text-sm text-grey-500 sm:h-9 sm:w-9 lg:h-11 lg:flex-1"
            >
              +
            </span>
          );
        }
        const f = fixtureOf(pick.fixture_id);
        const called =
          pick.predicted_outcome === 'DRAW'
            ? 'DRW'
            : abbreviate(
                (pick.predicted_outcome === 'HOME' ? f?.home : f?.away)?.name ??
                  '',
              );
        const label =
          pick.predicted_outcome === 'DRAW'
            ? `a draw between ${f?.home.name} and ${f?.away.name}`
            : `${(pick.predicted_outcome === 'HOME' ? f?.home : f?.away)?.name} to beat ${
                (pick.predicted_outcome === 'HOME' ? f?.away : f?.home)?.name
              }`;
        const shape = `flex h-8 w-8 items-center justify-center rounded-md border-[1.5px] text-[9px] font-bold sm:h-9 sm:w-9 lg:h-11 lg:flex-1 lg:text-[11px] ${
          SLOT_FILLED[pick.predicted_outcome]
        }`;

        // Inert unless the caller has something to do with a pick. In the
        // bar they sit inside the disclosure, where the useful thing to do
        // with a chip is read it, not lose it to a stray thumb.
        if (!onPick || !isMyTurn || f?.result !== null) {
          return (
            <span key={pick.id} aria-hidden title={label} className={shape}>
              {called}
            </span>
          );
        }
        return (
          <button
            key={pick.id}
            type="button"
            disabled={pending}
            onClick={() => onPick(pick.id)}
            title={`Drop your pick: ${label}`}
            aria-label={`Drop your pick: ${label}`}
            className={`${shape} disabled:cursor-default disabled:opacity-100`}
          >
            {called}
          </button>
        );
      })}
    </div>
  );

  /** What the bar says next to the slots, and whether there's a button. */
  const lockInButton = isMyTurn ? (
    <button
      type="button"
      onClick={lockIn}
      disabled={pending || owed > 0}
      data-tour="lock-in"
      className={`shrink-0 ${owed > 0 ? 'btn btn-ink' : 'btn btn-hot'}`}
    >
      <LockIcon className="h-4 w-4" />
      {pending ? 'Working…' : 'Lock in'}
    </button>
  ) : null;

  /**
   * What the bar says beside the slots.
   *
   * Measured rather than guessed: on a 375px phone the slots, the button and
   * the gutters leave about 110px for this, so both lines are written to fit
   * it. The first draft said "2 of 3 taken" over "1 more, then lock in" and
   * both ended in an ellipsis.
   */
  const barCaption = isMyTurn
    ? owed > 0
      ? {
          lead: `${myPicks.length} of ${draft.picks_per_player}`,
          note: `${owed} more to take`,
        }
      : {
          lead: `All ${draft.picks_per_player} in`,
          note: 'Lock in to pass on',
        }
    : owed === 0
      ? {
          lead: 'You’re all in',
          note: `Waiting on ${onTurn ? nameOf(onTurn) : 'the next player'}`,
        }
      : {
          lead: turnsAhead <= 1 ? 'You’re next' : `${turnsAhead} turns away`,
          note:
            remaining && remaining !== 'expired'
              ? `${remaining} on the clock`
              : 'Nothing to do yet',
        };

  return (
    <div className="flex flex-col gap-6">
      {/* ---- One header ----
              Page heading, subtitle, gameweek line, round strip and turn
              card were five stacked blocks all answering the same two
              questions: which round is this, and whose turn is it. They are
              one block now, and it sits above the thing you came to do
              rather than in front of it. */}
      <section className={`card p-5 ${isMyTurn ? 'border-hot' : ''}`}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="label">{roundLabel}</p>
          {/* `ml-auto` alone right-aligned this against nothing once it
              wrapped onto its own line on a phone, which read as a stray
              fragment. It only takes the right-hand slot when it shares a
              line. */}
          <p className="w-full text-sm text-grey-500 sm:ml-auto sm:w-auto">
            {isMyTurn && remaining ? (
              remaining === 'expired' ? (
                <span className="text-loss">
                  Turn expired &mdash; auto-pick due
                </span>
              ) : (
                <span className="font-medium text-hot">
                  Turn ends in{' '}
                  <span className="font-mono">{remaining}</span>
                </span>
              )
            ) : (
              <>closes {closesAt}</>
            )}
          </p>
        </div>

        <h1 className="display-lg mt-1">{headline}</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-grey-700">
          {standing}
        </p>

        {/* The running order. Yours is ringed; whoever is on the clock is
            first in the list, so the row reads as a queue. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ol className="flex flex-wrap gap-1.5">
            {order.map((userId, turn) => {
              const done = turn < draft.current_turn;
              const current = turn === draft.current_turn;
              return (
                <li
                  key={turn}
                  title={`Pick ${turn + 1}: ${nameOf(userId)}`}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${
                    current ? 'ring-2 ring-ink ring-offset-1' : ''
                  } ${done ? 'opacity-35' : ''}`}
                  style={{ background: colourOf(userId), color: '#111' }}
                >
                  {initialsOf(userId)}
                </li>
              );
            })}
          </ol>
          <span className="text-xs text-grey-500">
            {order.map((id) => nameOf(id)).join(', ')}
          </span>
        </div>

        {/* Each in its own wrapper, rather than both dropped straight into
            one flex container.
            
            They arrive as props, so the elements inside them were created by
            the page, not here — and React key-validates a children array
            whose members have a different owner, which it does not do for
            ordinary static JSX. Two `{...}` siblings are such an array, and
            it warned on every render. A wrapper each makes them single
            children, and gives the strip the leftover width to scroll in. */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-grey-100 pt-4">
          <div className="shrink-0">{scopeToggle}</div>
          <div className="w-full min-w-0 sm:w-auto sm:flex-1">{roundStrip}</div>
        </div>
      </section>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-loss/30 bg-loss/5 px-3 py-2 text-sm text-loss"
        >
          {error}
        </p>
      )}

      {/* ---- Board and rail ----
              Two columns from `lg`, one below it, and the board leads at
              every width and in every state.

              It used to flip: the slip led while you were waiting, on the
              grounds that there's nothing to do then and the slip is the
              news. Two things were wrong with that. Desktop never flipped —
              the rail is on the right whatever the state — so a phone
              disagreed with a laptop half the time. And it moved the slip,
              so a player who had learned where it lived found it somewhere
              else on the week it mattered. Fixed beats optimal: the board
              is the only part of this page you can act on, and the only
              part you can't get at from the pinned bar. */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-7">
        <div className="min-w-0 flex-1">
          <section data-tour="available">
            <h2 className="label mb-3 flex flex-wrap items-baseline gap-x-2">
              The board
              <span className="font-normal normal-case tracking-normal text-grey-400">
                {available.length} fixtures left
              </span>
            </h2>

            {available.length === 0 ? (
              <p className="card px-4 py-3 text-sm text-grey-700">
                Nothing left on the board for this gameweek &mdash; every
                fixture your division plays has been taken or has kicked off.
              </p>
            ) : (
              <div className="flex flex-col gap-7">
                {byLeague.map((league) => (
                  <div key={league.code}>
                    {/* The heading carries the league, so the rows below it
                        no longer each need a competition badge. */}
                    <h3 className="mb-3 flex items-baseline justify-between gap-3 border-b border-grey-300 pb-1.5">
                      <span className="font-display text-sm font-bold tracking-tight text-ink">
                        {league.name}
                      </span>
                      <span className="shrink-0 text-xs font-medium text-grey-500">
                        {league.fixtures.length} left
                      </span>
                    </h3>

                    <ul className="flex flex-col gap-1.5">
                      {league.fixtures.map((f) => {
                        const busy = submitting === f.id;
                        const open = openModel === f.id;
                        return (
                          <li
                            key={f.id}
                            className="overflow-hidden rounded-lg border border-grey-300 bg-card text-sm"
                          >
                            {/* On a phone the fixture takes the first line
                                and the three buttons take the second as
                                equal thirds, so they can't be squeezed
                                however long the clubs are. Once there's
                                room it all sits on one line. */}
                            <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
                              <button
                                type="button"
                                onClick={() => setOpenModel(open ? null : f.id)}
                                aria-expanded={open}
                                // The tour points at the first of these.
                                data-tour="fixture"
                                className="flex min-w-0 flex-1 items-center gap-2 text-left transition hover:text-lime-dark"
                                title="Show the model’s read on this fixture"
                              >
                                <span
                                  className="flex w-9 shrink-0 flex-col leading-tight"
                                  title={dayLong(f.kickoff_at)}
                                >
                                  <span className="text-[10px] text-grey-500">
                                    {dayShort(f.kickoff_at)}
                                  </span>
                                  <span className="font-mono text-xs">
                                    {time(f.kickoff_at)}
                                  </span>
                                </span>

                                <FixtureLine
                                  home={f.home.name}
                                  away={f.away.name}
                                  homeCrest={f.home.crest_url}
                                  awayCrest={f.away.crest_url}
                                  crestClass="h-5 w-5"
                                  className="min-w-0 flex-1"
                                />

                                {/* Tapping the clubs opened the model long
                                    before anything said so. A chevron is
                                    the whole fix. */}
                                <span
                                  aria-hidden
                                  className="shrink-0 text-grey-500"
                                >
                                  <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.4"
                                    strokeLinecap="round"
                                    className={`h-3.5 w-3.5 transition-transform ${
                                      open ? 'rotate-180' : ''
                                    }`}
                                  >
                                    <path d="M6 9l6 6 6-6" />
                                  </svg>
                                </span>
                              </button>

                              {/* Outcome buttons sit with the fixture: one
                                  tap to pick, rather than opening the row
                                  first and then choosing. */}
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

                            {open && (
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
            )}
          </section>

        </div>

        <aside className="w-full lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:w-[20rem] lg:shrink-0 lg:overflow-y-auto">
          <div className="flex flex-col gap-5">
            {/* The desktop home of the lock-in. There is room for it beside
                the board here, so it needs no pinned bar — it simply never
                leaves the screen. */}
            {draft.status !== 'complete' && (
              <div
                className={`card hidden p-4 lg:block ${
                  isMyTurn ? 'border-hot' : ''
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <p className="label">
                    {isMyTurn ? 'Your turn' : 'Your picks'}
                  </p>
                  {isMyTurn && remaining && remaining !== 'expired' && (
                    <p className="ml-auto font-mono text-sm font-medium text-hot">
                      {remaining}
                    </p>
                  )}
                </div>

                <div className="mt-3 flex">{slotsList(drop)}</div>

                <p className="mt-3 text-xs leading-relaxed text-grey-700">
                  {isMyTurn
                    ? owed > 0
                      ? `${myPicks.length} of ${draft.picks_per_player} taken. ${owed} more and you can lock in${
                          myPicks.length > 0 ? ' — tap a pick to drop it' : ''
                        }.`
                      : 'All in. Locking in passes the turn on — you can’t change them after.'
                    : `${barCaption.lead}. ${barCaption.note}.`}
                </p>

                {lockInButton && (
                  <div className="mt-3 [&>button]:w-full">{lockInButton}</div>
                )}
              </div>
            )}

            {/* ---- The slip ----
                    One list, from the first pick, filling as the division
                    drafts. Yours is the card that's lit. */}
            <section data-tour="slip">
              <h2 className="label mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <LockIcon open={!everyoneIn} className="h-3 w-3" />
                The slip
                <span className="font-normal normal-case tracking-normal text-grey-400">
                  {picks.length}/{expectedPicks} in
                </span>
              </h2>

              <Slip players={slipPlayers} />

              {/* One card at a time. Until the division is finished the only
                  complete thing to send is your own set; after that it's the
                  slip, which contains yours anyway. */}
              <div className="mt-4">
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
                  owed === 0 && (
                    <SharePicks
                      groups={[
                        { player: nameOf(currentUserId), picks: sharePicks },
                      ]}
                      gameweek={gameweekLabel}
                      subtitle={`${nameOf(currentUserId)} · ${divisionName}`}
                      locked={!isMyTurn}
                    />
                  )
                )}
              </div>
            </section>
          </div>
        </aside>
      </div>

      {/* Clears the pinned bar. It belongs at the end of the page, not at
          the end of the board column: on a phone the rail stacks *under*
          the board, so a spacer inside the board only pushed the slip down
          and left the share buttons — the ones the group chat runs on — sat
          underneath the bar. */}
      {draft.status !== 'complete' && (
        <div aria-hidden className="h-16 lg:hidden" />
      )}

      {/* ---- The pinned bar, phones and tablets ----
              This is the fix for the complaint that started the redesign:
              you could pick three fixtures and never find out that Lock in
              was waiting for you several screens up. It cannot be scrolled
              away from, and it carries your three slots so it doubles as a
              live view of your own row of the slip rather than a second copy
              of it. */}
      {draft.status !== 'complete' && (
        <div className="fixed inset-x-0 bottom-[var(--nav-height)] z-10 border-t border-grey-300 bg-card shadow-float sm:bottom-0 lg:hidden">
          {/* Your own row, opened out. Three chips can say you hold two of
              three and roughly who; they can't say Burnley away to Leeds,
              and that fixture is no longer on the board to go and check. */}
          {slipOpen && mySlip && mySlip.picks.length > 0 && (
            <div
              id="your-picks"
              className="mx-auto max-h-[45vh] w-full max-w-5xl overflow-y-auto border-b border-grey-100 px-4 pt-3 pb-1 sm:px-6"
            >
              <Slip players={[{ ...mySlip, name: null }]} />
            </div>
          )}

          <div className="mx-auto flex w-full max-w-5xl items-center gap-2.5 px-4 py-2.5 sm:gap-3 sm:px-6">
            <button
              type="button"
              onClick={() => setSlipOpen((open) => !open)}
              disabled={myPicks.length === 0}
              aria-expanded={slipOpen}
              aria-controls="your-picks"
              aria-label={
                myPicks.length === 0
                  ? `${barCaption.lead}. ${barCaption.note}.`
                  : slipOpen
                    ? 'Hide your picks'
                    : `Show your ${myPicks.length} pick${
                        myPicks.length === 1 ? '' : 's'
                      }`
              }
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default sm:gap-3"
            >
              {slotsList()}
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-sm font-medium">
                  {barCaption.lead}
                </span>
                <span className="truncate text-[11px] text-grey-500">
                  {barCaption.note}
                </span>
              </span>
              {myPicks.length > 0 && (
                <span aria-hidden className="shrink-0 text-grey-500">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    className={`h-3.5 w-3.5 transition-transform ${
                      slipOpen ? '' : 'rotate-180'
                    }`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              )}
            </button>
            {lockInButton}
          </div>
        </div>
      )}
    </div>
  );
}
