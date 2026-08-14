/**
 * Snake order, mirroring `draft_user_at_turn` in
 * `supabase/migrations/0002_draft_functions.sql`.
 *
 * This exists only so the UI can show who's up next and lay out the running
 * order. The database is still the authority — `make_pick` recomputes the same
 * thing server-side and rejects anything that disagrees, so a wrong answer here
 * shows a wrong label, never an illegal pick.
 *
 * With order [A, B, C]:
 *   round 0:  A B C
 *   round 1:  C B A
 *   round 2:  A B C
 */
export function userAtTurn(order: string[], turn: number): string | null {
  const n = order.length;
  if (n === 0 || turn < 0) return null;

  const round = Math.floor(turn / n);
  const position = turn % n;

  return round % 2 === 0 ? order[position] : order[n - 1 - position];
}

/** Every turn in the draft, in order. */
export function fullOrder(order: string[], picksPerPlayer: number): string[] {
  const total = order.length * picksPerPlayer;
  return Array.from(
    { length: total },
    (_, turn) => userAtTurn(order, turn) as string,
  );
}

/** Turn index → which round (0-based) it falls in. */
export function roundOfTurn(order: string[], turn: number): number {
  return order.length === 0 ? 0 : Math.floor(turn / order.length);
}
