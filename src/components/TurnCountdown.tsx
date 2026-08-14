'use client';

import { useEffect, useState } from 'react';

/**
 * Live countdown to the current turn's deadline.
 *
 * `now` starts null so the server render and the first client render agree on
 * showing placeholder dashes. Seeding it with Date.now() guarantees a
 * hydration mismatch — the server stamps one second into the HTML and the
 * client renders the next one a moment later.
 */
function useRemaining(target: string | null) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!target) return null;
  if (now === null) return { pending: true as const };

  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return { expired: true as const };

  return {
    hours: Math.floor(ms / 3_600_000),
    minutes: Math.floor((ms % 3_600_000) / 60_000),
    seconds: Math.floor((ms % 60_000) / 1000),
    /** Under fifteen minutes is where it stops being comfortable. */
    urgent: ms < 15 * 60_000,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

function Unit({
  value,
  label,
  dim,
}: {
  value: string;
  label: string;
  dim?: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <span
        className={`font-serif text-5xl leading-none tabular-nums sm:text-6xl ${
          dim ? 'text-white/30' : ''
        }`}
      >
        {value}
      </span>
      <span className="label mt-2 text-white/40">{label}</span>
    </div>
  );
}

export function TurnCountdown({
  expiresAt,
  isMyTurn,
  onTurnName,
}: {
  expiresAt: string | null;
  isMyTurn: boolean;
  onTurnName: string;
}) {
  const remaining = useRemaining(expiresAt);

  const heading = isMyTurn ? (
    <>
      You&rsquo;re on the clock
    </>
  ) : (
    <>
      Waiting on <span className="text-lime">{onTurnName}</span>
    </>
  );

  const sub = isMyTurn
    ? 'Pick three fixtures and lock them in before the clock runs out, or they’ll be picked for you.'
    : `${onTurnName} is drafting. You’ll be up once they lock in.`;

  return (
    <section
      className={`relative isolate overflow-hidden rounded-xl border px-6 py-7 text-white sm:px-8 ${
        isMyTurn ? 'border-lime bg-ink' : 'border-grey-300 bg-ink/95'
      }`}
    >
      {isMyTurn && (
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(70%_120%_at_20%_0%,rgba(200,241,53,0.18),transparent_65%)]"
        />
      )}

      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-56 flex-1">
          <p className="label text-white/40">
            {isMyTurn ? 'Your turn' : 'Turn in progress'}
          </p>
          <h2 className="display-lg mt-1.5">{heading}</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-white/60">
            {sub}
          </p>
        </div>

        {remaining && (
          <div className="shrink-0">
            {'expired' in remaining ? (
              <p className="font-serif text-3xl text-lime">
                Time&rsquo;s up &mdash; auto-picking
              </p>
            ) : 'pending' in remaining ? (
              <div className="flex items-start gap-3">
                <Unit value="--" label="hrs" dim />
                <span className="font-serif text-4xl text-white/20">:</span>
                <Unit value="--" label="min" dim />
                <span className="font-serif text-4xl text-white/20">:</span>
                <Unit value="--" label="sec" dim />
              </div>
            ) : (
              <div
                className={`flex items-start gap-3 ${
                  remaining.urgent ? 'text-loss' : 'text-lime'
                }`}
              >
                <Unit value={pad(remaining.hours)} label="hrs" />
                <span className="font-serif text-4xl text-white/20">:</span>
                <Unit value={pad(remaining.minutes)} label="min" />
                <span className="font-serif text-4xl text-white/20">:</span>
                <Unit value={pad(remaining.seconds)} label="sec" />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
