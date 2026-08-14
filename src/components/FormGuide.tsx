import { LockIcon } from '@/components/LockIcon';

export type PlayerForm = {
  userId: string;
  name: string;
  colour: string;
  avatarUrl: string | null;
  /** Oldest first, most recent last. */
  points: { gameweek: number; points: number }[];
  total: number;
};

function initialsOf(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  if (w.length === 1) return w[0].charAt(0).toUpperCase();
  return (w[0].charAt(0) + w[w.length - 1].charAt(0)).toUpperCase();
}

/**
 * Recent gameweek scores per player, most recent last.
 *
 * A running total says where everyone ended up; this says how they got there.
 * Three points then one then three is a different player from one who scored
 * seven in a single week, and the table alone can't tell them apart.
 *
 * Points are tinted by value rather than shown as bare numbers so a run is
 * readable at a glance without reading each figure.
 */
export function FormGuide({
  players,
  perfect,
  highlightUserId,
}: {
  players: PlayerForm[];
  /** Max points available per gameweek — 3 picks, 1 point each. */
  perfect: number;
  highlightUserId: string;
}) {
  const anyPlayed = players.some((p) => p.points.length > 0);

  if (!anyPlayed) {
    return (
      <p className="text-sm text-grey-500">
        No gameweeks scored yet &mdash; form appears once results come in.
      </p>
    );
  }

  const tone = (pts: number) =>
    pts >= perfect
      ? 'bg-lime text-ink'
      : pts === 0
        ? 'bg-loss/15 text-loss'
        : pts >= perfect / 2
          ? 'bg-win/20 text-win'
          : 'bg-grey-100 text-grey-700';

  return (
    <ul className="flex flex-col">
      {players.map((p) => (
        <li
          key={p.userId}
          className={`flex items-center gap-3 border-b border-grey-100 py-2.5 last:border-0 ${
            p.userId === highlightUserId ? 'font-medium' : ''
          }`}
        >
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-ink"
            style={{ background: p.colour }}
          >
            {p.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              initialsOf(p.name)
            )}
          </span>

          <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>

          <span className="flex shrink-0 items-center gap-1">
            {p.points.length === 0 ? (
              <span className="text-xs text-grey-400">no games</span>
            ) : (
              p.points.map((g) => (
                <span
                  key={g.gameweek}
                  title={`Gameweek ${g.gameweek}: ${g.points} point${g.points === 1 ? '' : 's'}`}
                  className={`flex h-6 w-6 items-center justify-center rounded text-xs font-semibold tabular-nums ${tone(g.points)}`}
                >
                  {g.points}
                </span>
              ))
            )}
          </span>

          <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">
            {p.total}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Small header used above the guide. */
export function FormGuideHeading({ count }: { count: number }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="label flex items-center gap-1.5">
        <LockIcon className="h-3 w-3" />
        Form guide
      </h2>
      <span className="text-xs text-grey-500">
        last {count} gameweek{count === 1 ? '' : 's'}
      </span>
    </div>
  );
}
