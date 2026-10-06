import { cookies } from 'next/headers';

/**
 * Which group you're currently looking at.
 *
 * A cookie rather than a query parameter, because the choice has to survive
 * moving between tabs: every page is league-scoped, and threading `?league=`
 * through the dashboard, the board, the results and the table — and every
 * link between them — would put the same id in a dozen places for one piece
 * of state that never changes mid-click.
 *
 * It is a preference, not a permission. Nothing trusts it: `viewingFor`
 * checks it against the groups you're actually in and falls back to the
 * first one, so a stale id from a group you've left, or an edited cookie,
 * shows you your own group rather than somebody else's.
 */
export const LEAGUE_COOKIE = 'league';

export async function activeLeagueId(): Promise<string | null> {
  return (await cookies()).get(LEAGUE_COOKIE)?.value ?? null;
}
