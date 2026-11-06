import { Crest } from '@/components/Crest';
import { abbreviate } from '@/lib/team-codes';
import type { Outcome } from '@/lib/types';

/**
 * One fixture, on one line, in every list that shows one.
 *
 * Two problems it exists to solve. Club names are long and wildly uneven —
 * "Wolverhampton Wanderers v Milton Keynes Dons" against "Hull v York" — so
 * a row sized to the text reflows on every line and, on a 375px phone,
 * simply ran out of room. Below `sm` this renders the three-letter code
 * instead, which is fixed-width enough that rows line up.
 *
 * And the call was printed as the club's name a second time, so a row read
 * "Liverpool v Man City · Liverpool". The side called is emboldened in
 * place instead — the same thing the shared text does with
 * `*LIVERPOOL* v Man City` — and a fixed-width HOME/DRAW/AWAY chip carries
 * the outcome. Both sides embolden for a called draw, again matching the
 * text format.
 */

const CHIP: Record<Outcome, { label: string; className: string }> = {
  HOME: { label: 'HOME', className: 'bg-lime text-on-accent' },
  DRAW: { label: 'DRAW', className: 'bg-grey-300 text-on-accent' },
  AWAY: { label: 'AWAY', className: 'bg-away text-white' },
};

/** Fixed width, so a column of these can be scanned straight down. */
export function OutcomeChip({
  outcome,
  className = '',
}: {
  outcome: Outcome;
  className?: string;
}) {
  const chip = CHIP[outcome];
  return (
    <span
      className={`w-14 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] leading-5 font-semibold ${chip.className} ${className}`}
    >
      {chip.label}
    </span>
  );
}

/** `LIV` on a phone, `Liverpool` once there's room for it. */
export function TeamName({
  name,
  called = false,
  className = '',
}: {
  name: string;
  called?: boolean;
  className?: string;
}) {
  return (
    // Never break a club across two lines: a row that grows taller as
    // names change length is the same reflow, just vertical.
    <span
      className={`whitespace-nowrap ${called ? 'font-semibold text-ink' : ''} ${className}`}
    >
      <span className="sm:hidden">{abbreviate(name)}</span>
      <span className="hidden sm:inline">{name}</span>
    </span>
  );
}

export function FixtureLine({
  home,
  away,
  homeCrest,
  awayCrest,
  outcome = null,
  crestClass = 'h-4 w-4',
  clip = true,
  className = '',
}: {
  home: string;
  away: string;
  homeCrest?: string | null;
  awayCrest?: string | null;
  /** The side called, emboldened in place. Null when nothing is called. */
  outcome?: Outcome | null;
  crestClass?: string;
  /**
   * Whether this may be cut short when the row runs out of room.
   *
   * On by default, for a slip: the names give way so the score and the
   * tick stay in their column, and a name you can half-read beside a
   * crest is still the fixture you picked.
   *
   * Off where the row can give way instead. A flex item that may shrink
   * to nothing never makes its row wrap — the browser satisfies
   * everything else first and clips this — so turning the clip off is
   * also what lets a wrapping row know this has a size worth keeping.
   */
  clip?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`flex items-center gap-1.5 ${
        clip ? 'min-w-0 overflow-hidden' : ''
      } ${className}`}
    >
      <Crest url={homeCrest} className={crestClass} />
      <TeamName name={home} called={outcome === 'HOME' || outcome === 'DRAW'} />
      <span className="text-grey-400">v</span>
      <Crest url={awayCrest} className={crestClass} />
      <TeamName name={away} called={outcome === 'AWAY' || outcome === 'DRAW'} />
    </span>
  );
}
