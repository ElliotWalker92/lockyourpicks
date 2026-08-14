'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { makePick } from '@/lib/actions/picks';
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
  competition: { code: string; name: string } | null;
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
  const [selected, setSelected] = useState<string | null>(null);
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
  const order = fullOrder(draft.pick_order, draft.picks_per_player);
  const myPicks = picks.filter((p) => p.user_id === currentUserId);

  const available = fixtures.filter((f) => !takenBy.has(f.id));

  function submit(fixtureId: string, outcome: Outcome) {
    setError(null);
    startTransition(async () => {
      const result = await makePick(draft.id, fixtureId, outcome);
      if (!result.ok) setError(result.error);
      else setSelected(null);
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
        className={`rounded-xl border p-4 ${
          isMyTurn
            ? 'border-lime-400 bg-lime-50 dark:border-lime-600 dark:bg-lime-950/30'
            : 'border-neutral-200 dark:border-neutral-800'
        }`}
      >
        {draft.status === 'complete' ? (
          <p className="font-medium">
            Draft complete — all picks are in for this gameweek.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-medium">
                {isMyTurn ? (
                  <>Your pick &mdash; choose a fixture and call it.</>
                ) : (
                  <>
                    Waiting on{' '}
                    <span className="font-semibold">
                      {onTurn ? nameOf(onTurn) : '—'}
                    </span>
                  </>
                )}
              </p>
              {remaining && (
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {remaining === 'expired' ? (
                    <span className="text-amber-700 dark:text-amber-500">
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
                        ? 'ring-2 ring-neutral-900 ring-offset-1 dark:ring-lime-300'
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
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {/* ---- Your picks ---- */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Your picks ({myPicks.length}/{draft.picks_per_player})
        </h2>
        {myPicks.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing drafted yet.</p>
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
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-neutral-200 px-3 py-2.5 text-sm dark:border-neutral-800"
                  >
                    <span className="flex-1">
                      {f.home.name} v {f.away.name}
                    </span>
                    <span className="font-medium">{called}</span>
                    {pick.is_auto_pick && (
                      <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                        auto
                      </span>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      {/* ---- Taken ---- */}
      {picks.length > myPicks.length && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
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
                    className="flex items-center gap-2.5 text-sm text-neutral-500"
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
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Available ({available.length})
        </h2>

        {!isMyTurn && draft.status === 'active' && (
          <p className="mb-3 text-sm text-neutral-500">
            You can look, but you can&rsquo;t pick until it&rsquo;s your turn.
          </p>
        )}

        <div className="flex flex-col gap-6">
          {byDay.map(([day, dayFixtures]) => (
            <div key={day}>
              <h3 className="mb-2 text-sm font-medium text-neutral-500">
                {day}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {dayFixtures.map((f) => {
                  const open = selected === f.id;
                  return (
                    <li
                      key={f.id}
                      className="rounded-lg border border-neutral-200 dark:border-neutral-800"
                    >
                      <button
                        type="button"
                        disabled={!isMyTurn || pending}
                        onClick={() => setSelected(open ? null : f.id)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition enabled:hover:bg-neutral-50 disabled:cursor-default dark:enabled:hover:bg-neutral-900"
                      >
                        <span className="w-12 shrink-0 font-mono text-xs text-neutral-500">
                          {time(f.kickoff_at)}
                        </span>
                        <span className="flex-1">
                          {f.home.name}{' '}
                          <span className="text-neutral-400">v</span>{' '}
                          {f.away.name}
                        </span>
                        {f.competition && (
                          <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                            {f.competition.code}
                          </span>
                        )}
                      </button>

                      {open && isMyTurn && (
                        <div className="flex flex-wrap gap-2 border-t border-neutral-200 px-3 py-2.5 dark:border-neutral-800">
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
                              disabled={pending}
                              onClick={() => submit(f.id, outcome)}
                              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-lime-300 dark:text-neutral-900 dark:hover:bg-lime-200"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
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
