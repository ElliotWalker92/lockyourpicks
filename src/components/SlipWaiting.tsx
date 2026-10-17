'use client';

import { useEffect, useState } from 'react';

import { formatDeadline } from '@/lib/turn-windows';

/**
 * What a player who hasn't picked is waiting on.
 *
 * "Nothing picked yet" said the one thing a reader can already see — the
 * row below it is empty — and none of what they actually want to know,
 * which is whether this is the person everybody is waiting on or somebody
 * whose turn hasn't started.
 *
 * So: a counter for whoever is on the clock, because the useful fact there
 * is how long is left and it changes while you watch; and a closing time
 * for the seats behind them, because the useful fact there is when it lands
 * on them. A projected time says "about" — it assumes everybody ahead uses
 * their full turn, and presenting that as a promise would be a lie that
 * gets found out every time somebody picks early.
 */

function useRemaining(target: string | null) {
  // Starts null so the server render and the first client render agree;
  // seeding it with Date.now() guarantees a hydration mismatch.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!target || now === null) return null;

  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return 'any moment';

  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);

  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function SlipWaiting({
  ahead,
  dueAt,
  projected,
}: {
  /** Turns that must finish first. 0 means they're on the clock. */
  ahead: number | null;
  dueAt: string | null;
  projected: boolean;
}) {
  const onTheClock = ahead === 0;
  const left = useRemaining(onTheClock ? dueAt : null);

  if (ahead === null || !dueAt) {
    return <p className="text-sm text-grey-500">Nothing picked yet.</p>;
  }

  if (onTheClock) {
    return (
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium text-hot">Picking now</span>
        {left && <span className="numeric text-grey-700">{left} left</span>}
        <span className="text-grey-500">
          closes {formatDeadline(new Date(dueAt))}
        </span>
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-grey-500">
      <span>
        {ahead === 1 ? 'Next up' : `${ahead} turns away`}
      </span>
      <span>
        {projected ? 'about ' : 'closes '}
        {formatDeadline(new Date(dueAt))}
      </span>
    </p>
  );
}
