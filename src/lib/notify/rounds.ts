import type { SupabaseClient } from '@supabase/supabase-js';

import { deliver } from '@/lib/notify/deliver';
import type { PushTarget } from '@/lib/notify/push';
import { isPlaceholderEmail } from '@/lib/notify/resend';
import { roundEmail } from '@/lib/notify/round-email';
import { callRpc } from '@/lib/supabase/rpc';
import type { Database } from '@/lib/types';

export type RoundReport = {
  due: number;
  sent: number;
  /** Of `sent`, how many went to a phone rather than an inbox. */
  pushed: number;
  skipped: number;
  errors: string[];
  warnings: string[];
};

type PendingRound = {
  league_id: string;
  gameweek_id: string;
  league_name: string;
  gameweek: number;
  email: string;
  display_name: string | null;
  divisions: number;
  players: number;
  push_targets: PushTarget[] | null;
};

export const emptyRoundReport = (): RoundReport => ({
  due: 0,
  sent: 0,
  pushed: 0,
  skipped: 0,
  errors: [],
  warnings: [],
});

/**
 * Tell whoever runs a group that its gameweek has finished drafting.
 *
 * What counts as finished is `round_is_in` in 0053, and deliberately not
 * restated here: a division that is a week behind has no draft row for
 * this gameweek at all, so "every draft is complete" is true of a round
 * half of which hasn't started.
 *
 * Stamped only after something gets through, same bargain as the turn
 * nudge: a provider outage delays the mail rather than losing it, at the
 * cost of a possible duplicate if the stamp fails after the send. The
 * round is in either way, so a second mail saying so is harmless — which
 * is the opposite of the trade the auto-pick warning makes, and the
 * reason this one is worth so little worry.
 */
export async function notifyRounds(
  supabase: SupabaseClient<Database>,
): Promise<RoundReport> {
  const report = emptyRoundReport();

  const { data, error } = await callRpc<PendingRound[]>(
    supabase,
    'pending_round_notifications',
  );
  if (error) throw new Error(`pending_round_notifications: ${error.message}`);

  const pending = data ?? [];
  report.due = pending.length;

  for (const round of pending) {
    try {
      const { how, warning } = await deliver(supabase, round, {
        push: {
          title: `Gameweek ${round.gameweek} is in`,
          body: `${round.league_name} — every pick is locked in.`,
          url: `/results?gw=${round.gameweek}&scope=group`,
          // One per round. A repeat replaces the earlier one rather than
          // stacking under it.
          tag: `round-${round.league_id}-${round.gameweek_id}`,
        },
        mail: roundEmail({
          name: round.display_name ?? 'there',
          league: round.league_name,
          gameweek: round.gameweek,
          divisions: round.divisions,
          players: round.players,
        }),
        headers: {
          'List-Unsubscribe': '<https://www.lockyourpicks.com/profile>',
        },
      });

      if (warning) report.warnings.push(warning);

      // Nothing got through and it wasn't a placeholder address: leave it
      // unstamped so the next run tries again.
      if (how === 'skipped' && !isPlaceholderEmail(round.email)) {
        report.skipped++;
        continue;
      }

      await callRpc(supabase, 'mark_round_notified', {
        p_league_id: round.league_id,
        p_gameweek_id: round.gameweek_id,
      });

      if (how === 'skipped') report.skipped++;
      else {
        report.sent++;
        if (how === 'push') report.pushed++;
      }
    } catch (err) {
      report.errors.push(
        `${round.league_name} gameweek ${round.gameweek}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return report;
}
