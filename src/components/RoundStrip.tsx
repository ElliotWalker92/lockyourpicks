import Link from 'next/link';

import type { Round } from '@/lib/rounds';

/**
 * Step back through the rounds you've played.
 *
 * Picks and Results were two tabs showing the same thing at two points in
 * time — what everyone called — which meant a player who wanted last week
 * had to know that "Results" was where the past lived. It's one tab now,
 * and this is the control that moves through it.
 *
 * The live round keeps its own route because it's a different screen: a
 * board you act on rather than a table you read.
 */
export function RoundStrip({
  rounds,
  live,
  selected,
  scope,
  inset = false,
}: {
  /** Rounds already drafted, newest first. The live one is excluded. */
  rounds: Round[];
  /** Gameweek number currently being drafted, if there is one. */
  live: number | null;
  /** Which chip is lit — a gameweek number, or the live board. */
  selected: number | 'live';
  scope: 'division' | 'group';
  /**
   * Inside a card rather than against the page.
   *
   * The negative margin below is right at page level and wrong in a box:
   * the chips push out through the card's own padding and the scroll track
   * runs under its border. The picks header puts this strip inside a card,
   * so it asks for the bleed to be left off.
   */
  inset?: boolean;
}) {
  const group = scope === 'group';
  const past = rounds.filter((r) => r.number !== live);

  if (!past.length && live === null) return null;

  const chip = (active: boolean) =>
    `btn btn-sm shrink-0 ${active ? 'btn-lime' : 'btn-outline'}`;

  return (
    <div
      // Bleeds to the screen edge so a long season scrolls past the gutter
      // rather than stopping short of it and looking like it has ended.
      className={`flex gap-2 overflow-x-auto pb-1 sm:flex-wrap ${
        inset ? '' : '-mx-4 px-4 sm:mx-0 sm:px-0'
      }`}
    >
      {live !== null && (
        <Link
          href={group ? '/draft?scope=group' : '/draft'}
          aria-current={selected === 'live' ? 'page' : undefined}
          className={chip(selected === 'live')}
        >
          GW{live}
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${
              selected === 'live' ? 'bg-on-accent' : 'bg-hot'
            }`}
          />
          <span className="sr-only">, drafting now</span>
        </Link>
      )}

      {past.map((round) => (
        <Link
          key={round.number}
          href={`/results?gw=${round.number}${group ? '&scope=group' : ''}`}
          aria-current={selected === round.number ? 'page' : undefined}
          className={chip(selected === round.number)}
        >
          GW{round.number}
        </Link>
      ))}
    </div>
  );
}
