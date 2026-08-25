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

  return peelEarlyStragglers(merged, kickoffOf, minSize);
}

/** At most this many fixtures can count as a block's leading stragglers. */
const LEAD_MAX = 3;
/** And the rest of the block must start at least this long after them. */
const LEAD_GAP_HOURS = 12;

/**
 * Move a block's handful of early fixtures back into the block before it.
 *
 * Picks close at a gameweek's first kickoff, because a fixture that has
 * started can't be drafted. So one Friday night game in front of a Saturday
 * programme drags the whole weekend's deadline forward a day — on this
 * season's fixture list that happens in eighteen gameweeks of sixty-four,
 * costing about seventeen hours of drafting each time.
 *
 * Handing those stragglers to the previous gameweek keeps every fixture
 * draftable — they're simply drafted earlier, in the round before — and lets
 * the weekend's deadline sit where the weekend actually starts.
 */
function peelEarlyStragglers<T>(
  blocks: Block<T>[],
  kickoffOf: (item: T) => Date,
  minSize: number,
): Block<T>[] {
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const items = [...block.items].sort(
      (a, b) => kickoffOf(a).getTime() - kickoffOf(b).getTime(),
    );

    const first = kickoffOf(items[0]).getTime();
    const lead = items.filter(
      (it) => kickoffOf(it).getTime() - first < 6 * 3_600_000,
    );

    if (lead.length > LEAD_MAX) continue;
    if (items.length - lead.length < minSize) continue;

    const bulkStart = kickoffOf(items[lead.length]).getTime();
    if (bulkStart - first < LEAD_GAP_HOURS * 3_600_000) continue;

    const previous = blocks[i - 1];
    previous.items.push(...lead);
    previous.end = kickoffOf(lead[lead.length - 1]);
    previous.absorbed += lead.length;

    block.items = items.slice(lead.length);
    block.start = kickoffOf(block.items[0]);
  }

  return blocks;
}

/**
 * When each gameweek's draft opens.
 *
 * A gameweek's picks lock at its first kickoff, and the next gameweek's draft
 * opens at that same moment — so exactly one draft is ever open, and you
 * spend a round of football drafting the next one. That gives three to four
 * days a gameweek instead of the hours a Tuesday cup tie used to leave.
 *
 * The first gameweek of a season has no predecessor, so it gets `leadDays`.
 */
export function draftWindows<T>(
  blocks: Block<T>[],
  leadDays = 3,
): { opensAt: Date; closesAt: Date }[] {
  return blocks.map((block, i) => ({
    opensAt:
      i === 0
        ? new Date(block.start.getTime() - leadDays * MS_PER_DAY)
        : blocks[i - 1].start,
    closesAt: block.start,
  }));
}
