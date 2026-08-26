import type { Outcome } from '@/lib/types';

export type Verdict = { decided: boolean; correct: boolean };

/**
 * How a pick is doing, from whatever is known so far.
 *
 * `points_awarded` is the authority and wins wherever it's set, but it isn't
 * written until the whole gameweek settles — so waiting for it means watching
 * a 2–1 sit on screen all Saturday with no idea whether you'd got it. A
 * fixture that has a result already answers the question: the rule is one
 * point per correct call, so applying it early isn't a guess, only the same
 * arithmetic sooner.
 *
 * Anywhere this shows a provisional total, say so — "2 from 3 so far" rather
 * than "2 pts" — so a running count never reads as a final one.
 */
export function verdictOf(pick: {
  predicted_outcome: Outcome;
  points_awarded?: number | null;
  result?: Outcome | null;
}): Verdict {
  if (pick.points_awarded !== null && pick.points_awarded !== undefined) {
    return { decided: true, correct: pick.points_awarded === 1 };
  }
  if (pick.result) {
    return { decided: true, correct: pick.result === pick.predicted_outcome };
  }
  return { decided: false, correct: false };
}

/** Running total across a set of picks, and whether it's final. */
export function tallyOf(
  picks: {
    predicted_outcome: Outcome;
    points_awarded?: number | null;
    result?: Outcome | null;
  }[],
) {
  const verdicts = picks.map(verdictOf);
  const decided = verdicts.filter((v) => v.decided).length;
  return {
    decided,
    landed: verdicts.filter((v) => v.correct).length,
    settled:
      picks.length > 0 &&
      picks.every((p) => p.points_awarded !== null && p.points_awarded !== undefined),
  };
}
