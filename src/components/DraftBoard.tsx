'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { lockInPicks, makePick, removePick } from '@/lib/actions/picks';
import { fullOrder, userAtTurn } from '@/lib/draft-order';
import { createClient } from '@/lib/supabase/client';
import type { Outcome } from '@/lib/types';

export type BoardTeam = {
  id: string;
  name: string;
  short_name: string | null;
  crest_url: string | null;
};

export type BoardFixture = {
  id: string;
  kickoff_at: string;
  home: BoardTeam;
  away: BoardTeam;
  competition: { code: string; name: string; tier: number | null } | null;
};

export type BoardPick = {
  id: string;
  user_id: string;
  fixture_id: string;
  predicted_outcome: Outcome;
  pick_number: number;
  is_auto_pick: boolean;
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
}: {
  draft: BoardDraft;
  fixtures: BoardFixture[];
  picks: BoardPick[];
  players: BoardPlayer[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState<string | null>(null);
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

  const available = fixtures.filter((f) => !takenBy.has(f.id));

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

  const byDay = useMemo(() => {
    const groups = new Map<string, BoardFixture[]>();
    for (const f of available) {
      const day = new Date(f.kickoff_at).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        timeZone: 'Europe/London',
      });
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push(f);
    }
    return Array.from(groups.entries());
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
        className={`card p-5 ${isMyTurn ? 'border-lime-dark bg-lime/10' : ''}`}
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
                    Your pick &mdash; <span className="italic">choose one</span>
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

      {/* ---- Your picks ---- */}
      <section>
        <h2 className="label mb-3">
          Your picks ({myPicks.length}/{draft.picks_per_player})
          {isMyTurn && myPicks.length > 0 && (
            <span className="ml-2 font-normal normal-case tracking-normal text-grey-400">
              not locked in yet
            </span>
          )}
        </h2>
        {myPicks.length === 0 ? (
          <p className="text-sm text-grey-500">
            {isMyTurn
              ? `Pick ${draft.picks_per_player} fixtures below. You can change them until you lock in.`
              : 'Nothing drafted yet.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {myPicks
              .sort((a, b) => a.pick_number - b.pick_number)
              .map((pick) => {
                const f = fixtures.find((x) => x.id === pick.fixture_id);
                if (!f) return null;
                const called =
                  pick.predicted_outcome === 'HOME'
                    ? f.home.name
                    : pick.predicted_outcome === 'AWAY'
                      ? f.away.name
                      : 'Draw';
                return (
                  <li
                    key={pick.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 card px-3 py-2.5 text-sm "
                  >
                    <span className="flex-1">
                      {f.home.name} v {f.away.name}
                    </span>
                    <span className="font-medium">{called}</span>
                    {pick.is_auto_pick && (
                      <span className="rounded bg-grey-100 px-1.5 py-0.5 text-xs text-grey-700">
                        auto
                      </span>
                    )}
                    {isMyTurn && (
                      <button
                        type="button"
                        onClick={() => drop(pick.id)}
                        disabled={pending}
                        className="text-xs text-grey-500 underline underline-offset-2 transition hover:text-loss"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                );
              })}
          </ul>
        )}

        {isMyTurn && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={lockIn}
              disabled={pending || myPicks.length < draft.picks_per_player}
              className="btn btn-ink"
            >
              {pending ? 'Working…' : 'Lock in my picks'}
            </button>
            <p className="text-sm text-grey-500">
              {myPicks.length < draft.picks_per_player
                ? `${draft.picks_per_player - myPicks.length} more to pick.`
                : 'Locking in passes the turn on — you can’t change them after.'}
            </p>
          </div>
        )}
      </section>

      {/* ---- Taken ---- */}
      {picks.length > myPicks.length && (
        <section>
          <h2 className="label mb-3">
            Gone
          </h2>
          <ul className="flex flex-col gap-1.5">
            {picks
              .filter((p) => p.user_id !== currentUserId)
              .map((pick) => {
                const f = fixtures.find((x) => x.id === pick.fixture_id);
                if (!f) return null;
                return (
                  <li
                    key={pick.id}
                    className="flex items-center gap-2.5 text-sm text-grey-500"
                  >
                    <span
                      aria-hidden
                      className="h-5 w-5 shrink-0 rounded-full"
                      style={{ background: colourOf(pick.user_id) }}
                    />
                    <span className="line-through">
                      {f.home.name} v {f.away.name}
                    </span>
                    <span className="text-xs">
                      taken by {nameOf(pick.user_id)}
                    </span>
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      {/* ---- Available ---- */}
      <section>
        <h2 className="label mb-3">
          Available ({available.length})
        </h2>

        {!isMyTurn && draft.status === 'active' && (
          <p className="mb-3 text-sm text-grey-500">
            You can look, but you can&rsquo;t pick until it&rsquo;s your turn.
          </p>
        )}

        <div className="flex flex-col gap-6">
          {byDay.map(([day, dayFixtures]) => (
            <div key={day}>
              <h3 className="mb-2 text-sm font-medium text-grey-500">
                {day}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {dayFixtures.map((f) => {
                  const busy = submitting === f.id;
                  return (
                    <li
                      key={f.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-grey-300 bg-card px-3 py-2.5 text-sm"
                    >
                      <span className="w-12 shrink-0 font-mono text-xs text-grey-500">
                        {time(f.kickoff_at)}
                      </span>

                      <span className="min-w-40 flex-1">
                        {f.home.name} <span className="text-grey-400">v</span>{' '}
                        {f.away.name}
                      </span>

                      {f.competition && (
                        <span className="shrink-0 rounded bg-grey-100 px-1.5 py-0.5 text-xs font-medium text-grey-500">
                          {f.competition.code}
                        </span>
                      )}

                      {/* Outcome buttons sit inline: one tap to pick, rather
                          than opening the row first and then choosing. */}
                      <span className="flex shrink-0 gap-1.5">
                        {(
                          [
                            ['HOME', f.home.short_name || f.home.name],
                            ['DRAW', 'Draw'],
                            ['AWAY', f.away.short_name || f.away.name],
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
                            className={`btn btn-lime btn-sm ${
                              busy ? 'opacity-60' : ''
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
