import type { SupabaseClient } from '@supabase/supabase-js';

import { deliver } from '@/lib/notify/deliver';
import type { PushTarget } from '@/lib/notify/push';
import { isPlaceholderEmail } from '@/lib/notify/resend';
import { turnEmail } from '@/lib/notify/turn-email';
import { callRpc } from '@/lib/supabase/rpc';
import type { Database } from '@/lib/types';

export type NotifyReport = {
  due: number;
  sent: number;
  /** Of `sent`, how many went to a phone rather than an inbox. */
  pushed: number;
  /** Three-hours-left nudges, counted apart from the turn itself. */
  warned: number;
  skipped: number;
  errors: string[];
  /**
   * Things worth knowing that aren't failures — a push that had to fall
   * back to email still told the player, so it must not fail the run and
   * wake the admins. `runCron` reads `errors` and ignores these.
   */
  warnings: string[];
};

type PendingTurn = {
  draft_id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  division_name: string;
  league_name: string;
  gameweek: number;
  expires_at: string | null;
  push_targets: PushTarget[] | null;
};

/**
 * Tell whoever is on the clock, and hasn't been told.
 *
 * Which channel that is belongs to `deliver`, not here.
 *
 * Marked as notified only after something succeeds, so a provider outage
 * means a delayed notification rather than a silently skipped one. The cost
 * of that choice is a possible duplicate if the mark fails after the send —
 * which is the right way round: two nudges is a nuisance, none is a player
 * getting auto-picked without warning.
 */
export async function notifyTurns(
  supabase: SupabaseClient<Database>,
): Promise<NotifyReport> {
  const report: NotifyReport = {
    due: 0,
    sent: 0,
    pushed: 0,
    warned: 0,
    skipped: 0,
    errors: [],
    warnings: [],
  };

  const { data, error } = await callRpc<PendingTurn[]>(
    supabase,
    'pending_turn_notifications',
  );
  if (error) throw new Error(`pending_turn_notifications: ${error.message}`);

  const pending = data ?? [];
  report.due = pending.length;

  /**
   * Tell one player, and count a fallback without failing the run.
   *
   * Returns whether anything got through, so the caller knows whether to
   * stamp the row: an unstamped turn is retried, a stamped one is not.
   */
  const tell = async (
    turn: PendingTurn,
    kind: 'start' | 'warning',
  ): Promise<'push' | 'email' | 'skipped'> => {
    const { how, warning } = await deliver(supabase, turn, {
      push: {
        title: kind === 'warning' ? 'Three hours left' : 'You’re on the clock',
        // Named by group, not just division. Somebody in two groups is in
        // a "Division 1" and a "Division 2" at once, and the division
        // alone doesn't say which one wants them.
        body:
          kind === 'warning'
            ? `${turn.league_name} · ${turn.division_name} — your picks are due soon.`
            : `${turn.league_name} · ${turn.division_name} — gameweek ${turn.gameweek}, you're up.`,
        url: '/draft',
        // One notification per turn per kind: a repeat replaces the
        // earlier one rather than stacking under it.
        tag: `${kind}-${turn.draft_id}`,
      },
      mail: turnEmail({
        name: turn.display_name ?? 'there',
        division: turn.division_name,
        league: turn.league_name,
        gameweek: turn.gameweek,
        expiresAt: turn.expires_at,
        kind,
      }),
      headers: {
        'List-Unsubscribe': '<https://www.lockyourpicks.com/profile>',
      },
    });

    if (warning) report.warnings.push(warning);
    return how;
  };

  for (const turn of pending) {
    try {
      const how = await tell(turn, 'start');
      if (how === 'skipped' && !isPlaceholderEmail(turn.email)) {
        report.skipped++;
        continue;
      }

      await callRpc(supabase, 'mark_turn_notified', {
        p_draft_id: turn.draft_id,
      });

      if (how === 'skipped') report.skipped++;
      else {
        report.sent++;
        if (how === 'push') report.pushed++;
      }
    } catch (err) {
      report.errors.push(
        `${turn.email}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ---- Three hours to go ----
  //
  // Separate pass, separate stamp. The turn email lands when the player in
  // front of you finishes; this one lands when it actually matters.
  const { data: dueSoon, error: warnError } = await callRpc<PendingTurn[]>(
    supabase,
    'pending_turn_warnings',
  );
  if (warnError) {
    report.errors.push(`pending_turn_warnings: ${warnError.message}`);
    return report;
  }

  for (const turn of dueSoon ?? []) {
    try {
      const how = await tell(turn, 'warning');
      if (how === 'skipped' && !isPlaceholderEmail(turn.email)) continue;

      await callRpc(supabase, 'mark_turn_warned', { p_draft_id: turn.draft_id });
      if (how !== 'skipped') report.warned++;
    } catch (err) {
      report.errors.push(
        `${turn.email} (warning): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return report;
}
