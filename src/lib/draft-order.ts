/**
 * Turn order, mirroring `draft_user_at_turn` in
 * `supabase/migrations/0009_lock_in_picks.sql`.
 *
 * One turn per player per gameweek — not one per pick. On your turn you make
 * all your picks, adjust them, then lock in; locking in passes the turn on.
 *
 * The order is a plain rotation, and the *starting* player rotates by gameweek
 * (GW1 starts with the first player, GW2 the second, GW4 back to the first).
 * That rotation is baked into `pick_order` when the draft is created, so this
 * only has to read the array.
 *
 * There is no snake here. Snake ordering existed to stop the first picker
 * taking the best fixture in every round; with one turn each there are no
 * rounds to balance.
 *
 * The database remains the authority — `make_pick` and `lock_in_picks`
 * recompute the same thing and reject anything that disagrees, so a bug here
 * shows a wrong label, never an illegal pick.
 */
export function userAtTurn(order: string[], turn: number): string | null {
  if (turn < 0 || turn >= order.length) return null;
  return order[turn];
}

/** Every turn in the draft, in order — one per player. */
export function fullOrder(order: string[]): string[] {
  return [...order];
}
