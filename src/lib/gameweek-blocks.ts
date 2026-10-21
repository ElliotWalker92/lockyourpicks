/**
 * Cutting a season's fixtures into gameweeks.
 *
 * A gameweek used to be a fixed Tuesday→Monday window, which broke in every
 * week the EFL Cup played. The cup goes on a Tuesday, `draft_closes_at` is the
 * first kickoff of the window, and so drafting for a gameweek whose forty
 * league fixtures were the following Saturday had to be finished by Tuesday
 * teatime — fourteen hours after it opened.
 *
 * A midweek round is its own round of football, so it is now its own
 * gameweek. Fixtures are bucketed by week and by which half of it they fall
 * in — Tuesday to Thursday, or Friday to Monday — and each bucket becomes a
 * gameweek. The two halves are ordered, so a cup Tuesday is drafted and
 * settled before the weekend it used to be lumped in with.
 *
 * Friday night belongs to the weekend it opens, not to the midweek before
 * it. That is the round as anyone watching would describe it, and it is
 * worth what it costs: picks close at a gameweek's first kickoff, so a
 * Friday night game closes the weekend's draft on Friday evening rather
 * than Saturday morning. Moving those games back a round would buy about
 * seventeen hours of drafting and put them in the wrong week, which is a
 * bad trade.
 *
 * Genuine outliers — a lone Thursday tie, a Monday night game standing on
 * its own — are handled by the minimum size rule rather than by special
 * cases: a block too small to draft from folds into its neighbour.
 */

/** Friday, Saturday, Sunday, Monday — `Date.getUTCDay()` numbering. */
const WEEKEND_DAYS = new Set([5, 6, 0, 1]);

const MS_PER_DAY = 86_400_000;

/**
 * Fewest fixtures a gameweek can carry.
 *
 * A division of three needs nine, and the largest workable division size was
 * measured at three. Ten leaves a fixture spare rather than forcing the last
 * player to take whatever is left.
 */
export const MIN_FIXTURES_PER_GAMEWEEK = 10;

export type BlockKind = 'midweek' | 'weekend';

export type Block<T> = {
  kind: BlockKind;
  items: T[];
  start: Date;
  end: Date;
  /** How many fixtures were folded in from an undersized neighbouring block. */
  absorbed: number;
};

/** Days since the Tuesday on or before `d`, used to group a week together. */
function tuesdayWeekIndex(d: Date): number {
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const sinceTuesday = (d.getUTCDay() - 2 + 7) % 7;
  return (midnight - sinceTuesday * MS_PER_DAY) / MS_PER_DAY;
}

export function kindOf(d: Date): BlockKind {
  return WEEKEND_DAYS.has(d.getUTCDay()) ? 'weekend' : 'midweek';
}

/**
 * Group fixtures into gameweek-sized blocks, in kickoff order.
 *
 * Blocks smaller than `minSize` are folded into the block before them — a
 * lone Thursday tie is not a gameweek, and leaving it as one would give a
 * division nothing to draft. The first block has nothing before it, so an
 * undersized opener folds forwards instead.
 */
export function blocksFrom<T>(
  items: T[],
  kickoffOf: (item: T) => Date,
  minSize = MIN_FIXTURES_PER_GAMEWEEK,
): Block<T>[] {
  const sorted = [...items].sort(
    (a, b) => kickoffOf(a).getTime() - kickoffOf(b).getTime(),
  );

  const buckets = new Map<string, Block<T>>();
  const order: string[] = [];

  for (const item of sorted) {
    const at = kickoffOf(item);
    const key = `${tuesdayWeekIndex(at)}:${kindOf(at)}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        kind: kindOf(at),
        items: [],
        start: at,
        end: at,
        absorbed: 0,
      };
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.items.push(item);
    bucket.end = at;
  }

  const blocks = order.map((k) => buckets.get(k)!);

  // Fold undersized blocks backwards.
  const merged: Block<T>[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (block.items.length < minSize && previous) {
      previous.items.push(...block.items);
      previous.end = block.end;
      previous.absorbed += block.items.length;
    } else {
      merged.push({ ...block, items: [...block.items] });
    }
  }

  // An undersized opener has nothing behind it, so it folds forwards.
  while (merged.length > 1 && merged[0].items.length < minSize) {
    const opener = merged.shift()!;
    const next = merged[0];
    next.items.unshift(...opener.items);
    next.start = opener.start;
    next.absorbed += opener.items.length;
  }

  return merged;
}

/**
 * Slot fixtures into blocks that are already decided.
 *
 * `blocksFrom` cuts the calendar; this puts everything else where it falls.
 * The separation is the point: a competition a group opted into should be
 * draftable in whichever round it lands in, without moving the edges of
 * that round for the groups who didn't.
 *
 * A fixture goes in the last block that had started by the time it kicks
 * off, which is the same rule the fixture ingest uses to map a kickoff to a
 * gameweek. One before the season's first block belongs to that first block
 * — there is nothing earlier for it to join.
 */
export function attachToBlocks<T>(
  blocks: Block<T>[],
  items: T[],
  kickoffOf: (item: T) => Date,
): Block<T>[] {
  if (!blocks.length || !items.length) return blocks;

  const out = blocks.map((b) => ({ ...b, items: [...b.items] }));

  for (const item of items) {
    const at = kickoffOf(item);
    const t = at.getTime();

    let index = 0;
    for (let i = 0; i < out.length; i++) {
      if (out[i].start.getTime() <= t) index = i;
      else break;
    }

    out[index].items.push(item);
    if (at > out[index].end) out[index].end = at;
  }

  // Kickoff order within a block, so a block's items still read as a card.
  for (const block of out) {
    block.items.sort(
      (a, b) => kickoffOf(a).getTime() - kickoffOf(b).getTime(),
    );
  }

  return out;
}

/**
 * Noon on the last Sunday that leaves a decent run at the draft.
 *
 * Sunday because that is when a football week resets and people are around;
 * noon because a notification at noon gets read. `minLeadHours` keeps it
 * from landing so close to kickoff that the window is theatre — if this
 * Sunday is too late, the one before it is used.
 *
 * Built in London time, since it is a time people read.
 */
function sundayNoonBefore(closesAt: Date, minLeadHours = 48): Date {
  const limit = new Date(closesAt.getTime() - minLeadHours * 60 * 60 * 1000);

  // Walk back from the limit to the most recent Sunday, then set noon.
  const london = new Date(
    limit.toLocaleString('en-US', { timeZone: 'Europe/London' }),
  );
  const offset = limit.getTime() - london.getTime();

  const sunday = new Date(london);
  sunday.setDate(sunday.getDate() - sunday.getDay()); // getDay() 0 = Sunday
  sunday.setHours(12, 0, 0, 0);

  const asUtc = new Date(sunday.getTime() + offset);
  // Setting noon can push past the limit when the limit is a Sunday
  // morning; a week earlier is still better than a window of hours.
  return asUtc > limit
    ? new Date(asUtc.getTime() - 7 * MS_PER_DAY)
    : asUtc;
}

/**
 * When each gameweek's draft opens.
 *
 * A gameweek's picks lock at its first kickoff, and the next gameweek's
 * draft opened at that same moment — so exactly one draft is ever open, and
 * you spend a round of football drafting the next one.
 *
 * That alone put the opening of a midweek round on the previous Friday
 * night, where the first notification went out to people at the pub and the
 * first deadline fell in the middle of a Saturday. Gameweek 15 auto-picked
 * five of nine players that way. So a draft also waits for noon on the
 * Sunday before it: whichever of the two is later.
 *
 * For a weekend gameweek nothing changes, because the previous kickoff is
 * already past that Sunday. It is the midweek rounds this is for.
 *
 * The first gameweek of a season has no predecessor, so it gets `leadDays`.
 */
export function draftWindows<T>(
  blocks: Block<T>[],
  leadDays = 3,
): { opensAt: Date; closesAt: Date }[] {
  return blocks.map((block, i) => {
    const afterPrevious =
      i === 0
        ? new Date(block.start.getTime() - leadDays * MS_PER_DAY)
        : blocks[i - 1].start;

    const sunday = sundayNoonBefore(block.start);

    return {
      opensAt: sunday > afterPrevious ? sunday : afterPrevious,
      closesAt: block.start,
    };
  });
}
