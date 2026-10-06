/**
 * How many fixtures each player takes, given how many play in a division.
 *
 * Not a setting. The two numbers multiply — once a match is taken nobody
 * else in that division can have it, so a division needs size × picks
 * distinct fixtures every gameweek — and the tightest gameweeks on this
 * season's card carry ten. A bigger division has to take less each, so
 * asking an owner for both numbers was asking them to do arithmetic
 * against a fixture list they can't see.
 *
 *      2 players   4 picks    8 fixtures
 *      3 players   3 picks    9
 *      4 players   2 picks    8
 *      5 players   2 picks   10
 *      6 to 10     1 pick    6 to 10
 *
 * Mirrors `picks_for_division_size` in migration 0029, which is the one
 * that counts: it is what the database writes when the size changes and
 * what a draft copies when it opens. This copy exists so the form can show
 * the consequence as the owner moves the selector, without a round trip.
 * If one changes, the other changes with it.
 */
export function picksForDivisionSize(size: number): number {
  if (size <= 2) return 4;
  if (size === 3) return 3;
  if (size <= 5) return 2;
  return 1;
}

/** The fixtures a division of this size needs every gameweek. */
export const fixturesNeeded = (size: number) =>
  size * picksForDivisionSize(size);
