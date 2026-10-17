import type { ReactNode } from 'react';

/**
 * The one table in this app.
 *
 * There were three, and they disagreed about nearly everything: the real
 * league tables were a bordered card with a bold `label` head, four-pixel
 * gutters and a coloured zone bar; the group table was a bare grid with a
 * lighter head, no card and no gutters; and the global leaderboard wasn't a
 * table at all but a list of flex rows with its own header bar and its own
 * idea of what a position looked like. Three ways of saying "who is ahead".
 *
 * This is the league-table treatment, which is the one that reads best and
 * the one people already know from every football site they use. The parts
 * that genuinely differ between the three — what the identity cell holds, a
 * club crest or a player's avatar, and which numbers follow it — are props.
 */

export type Zone = 'promotion' | 'playoff' | 'relegation';

export const ZONE_BAR: Record<Zone, string> = {
  promotion: 'bg-lime',
  playoff: 'bg-away',
  relegation: 'bg-loss',
};

export const ZONE_LABEL: Record<Zone, string> = {
  promotion: 'Promotion / Europe',
  playoff: 'Play-offs',
  relegation: 'Relegation',
};

/** Only the zones actually present, so a legend never explains a colour that isn't there. */
export function ZoneLegend({
  zones,
  labels = ZONE_LABEL,
}: {
  zones: Zone[];
  labels?: Record<Zone, string>;
}) {
  if (!zones.length) return null;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-grey-500">
      {zones.map((zone) => (
        <span key={zone} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={`h-3 w-1 rounded-full ${ZONE_BAR[zone]}`}
          />
          {labels[zone]}
        </span>
      ))}
    </div>
  );
}

export type Column<T> = {
  /** Short head, the way a football table heads them: P, W, GD, Pts. */
  label: string;
  /** Shown instead of `label`, when the heading wants to say more. */
  head?: ReactNode;
  /** Breakpoint below which the column is dropped. Absent means always on. */
  from?: 'sm' | 'md' | 'lg';
  /** The points column: display face, full contrast. One per table. */
  emphasis?: boolean;
  /** Left-aligned and elastic, for a row of badges rather than a number. */
  wide?: boolean;
  value: (row: T) => ReactNode;
};

/**
 * A number sitting straight after a row of club badges reads as part of
 * them, so the column following a `wide` one gets a wider gutter.
 */
const afterWide = <T,>(columns: Column<T>[], i: number) =>
  columns[i - 1]?.wide ? 'pl-5' : 'pl-3';

const SHOW_FROM = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
} as const;

/**
 * The right-hand gutter, on whichever column is last *at this width*.
 *
 * `last:pr-4` looks like the answer and isn't: `:last-child` counts the last
 * element, not the last visible one, so on the league table it landed on
 * Form — which is hidden below `lg` — and Pts was left jammed against the
 * card border with no gutter at all.
 *
 * Hidden columns change which one is last at every breakpoint, so the gutter
 * has to move with them: switched on where a column becomes last, and off
 * again where a wider screen reveals another behind it.
 *
 * Written as whole literal class names on purpose. Tailwind scans source
 * text, so a composed `${bp}:pr-4` would never be generated.
 */
const BREAKPOINTS = ['base', 'sm', 'md', 'lg'] as const;
type Breakpoint = (typeof BREAKPOINTS)[number];

const GUTTER_ON: Record<Breakpoint, string> = {
  base: 'pr-4',
  sm: 'sm:pr-4',
  md: 'md:pr-4',
  lg: 'lg:pr-4',
};

const GUTTER_OFF: Record<Breakpoint, string> = {
  base: 'pr-0',
  sm: 'sm:pr-0',
  md: 'md:pr-0',
  lg: 'lg:pr-0',
};

const WIDTH_RANK: Record<Breakpoint, number> = { base: 0, sm: 1, md: 2, lg: 3 };

function gutterFor<T>(columns: Column<T>[], index: number): string {
  const classes: string[] = [];
  let wasLast = false;

  for (const breakpoint of BREAKPOINTS) {
    const lastVisible = columns.reduce(
      (last, column, i) =>
        !column.from || WIDTH_RANK[column.from] <= WIDTH_RANK[breakpoint]
          ? i
          : last,
      -1,
    );
    const isLast = lastVisible === index;
    if (isLast === wasLast) continue;
    // At `base` there is nothing to turn off — no gutter is the default.
    if (isLast) classes.push(GUTTER_ON[breakpoint]);
    else if (breakpoint !== 'base') classes.push(GUTTER_OFF[breakpoint]);
    wasLast = isLast;
  }

  return classes.join(' ');
}

export function StandingsTable<T>({
  rows,
  keyOf,
  rank,
  zoneOf,
  identityLabel,
  identity,
  columns,
  highlight,
  title,
  subtitle,
}: {
  rows: T[];
  keyOf: (row: T) => string;
  /** Usually the position; a string so `4=` can carry its own tie marker. */
  rank: (row: T) => ReactNode;
  zoneOf?: (row: T) => Zone | null;
  /** Head for the identity column — 'Team' or 'Player'. */
  identityLabel: string;
  /** Crest or avatar, plus the name. */
  identity: (row: T) => ReactNode;
  columns: Column<T>[];
  /** The signed-in player's row. */
  highlight?: (row: T) => boolean;
  /** Card header, for a page showing several tables at once. */
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="card overflow-x-auto">
      {title && (
        <div className="flex items-baseline gap-3 border-b border-grey-300 px-4 py-3">
          <h2 className="label flex-1">{title}</h2>
          {subtitle && (
            <span className="text-xs text-grey-500">{subtitle}</span>
          )}
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="label border-b border-grey-300 text-left">
            <th className="py-3 pr-2 pl-4 font-bold">#</th>
            <th className="py-3 font-bold">{identityLabel}</th>
            {columns.map((column, i) => (
              <th
                key={column.label}
                className={`py-3 font-bold ${afterWide(columns, i)} ${
                  column.wide ? 'text-left' : 'text-right'
                } ${column.from ? SHOW_FROM[column.from] : ''} ${gutterFor(
                  columns,
                  i,
                )}`}
              >
                {column.head ?? column.label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const zone = zoneOf?.(row) ?? null;
            return (
              <tr
                key={keyOf(row)}
                className={`border-b border-grey-100 last:border-0 ${
                  highlight?.(row) ? 'bg-hot/5 font-medium' : ''
                }`}
              >
                <td className="relative py-2.5 pr-2 pl-4">
                  {/* A bar rather than a tinted row: it reads at a glance
                      without washing out the text on top of it. */}
                  {zone && (
                    <span
                      aria-hidden
                      className={`absolute top-0 bottom-0 left-0 w-1 ${ZONE_BAR[zone]}`}
                    />
                  )}
                  <span className="numeric text-grey-400">{rank(row)}</span>
                </td>

                {/* max-w-0 with w-full is what makes truncation work in a
                    table: the cell takes the slack, then clips. */}
                <td className="w-full max-w-0 py-2.5 pr-2">{identity(row)}</td>

                {columns.map((column, i) => (
                  <td
                    key={column.label}
                    className={`py-2.5 ${afterWide(columns, i)} ${
                      column.wide ? '' : 'text-right tabular-nums'
                    } ${
                      column.emphasis ? 'numeric text-base' : 'text-grey-500'
                    } ${column.from ? SHOW_FROM[column.from] : ''} ${gutterFor(
                      columns,
                      i,
                    )}`}
                  >
                    {column.value(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Crest/avatar plus name, sized and spaced the same in every table. */
export function Identity({
  badge,
  name,
  note,
}: {
  badge: ReactNode;
  name: string;
  /** A quiet second line, for a row that needs explaining. */
  note?: string;
}) {
  return (
    <span className="flex items-center gap-2.5">
      {badge}
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium" title={name}>
          {name}
        </span>
        {note && (
          <span className="truncate text-[11px] leading-tight text-grey-500">
            {note}
          </span>
        )}
      </span>
    </span>
  );
}
