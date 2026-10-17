import type { SupabaseClient } from '@supabase/supabase-js';

import { type PushTarget, pushConfigured, sendPush } from '@/lib/notify/push';
import { isPlaceholderEmail, sendEmail } from '@/lib/notify/resend';
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
 * A phone beats an inbox, so a player with a device registered gets a push
 * and no email: a turn email went to junk once already, and two nudges for
 * one turn trains people to ignore both. Email remains the channel for
 * everyone who hasn't installed the app, and the fallback whenever every
 * one of a player's devices refuses the push — a dead subscription must not
 * be the reason nobody was told.
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
  const canPush = pushConfigured();

  const { data, error } = await callRpc<PendingTurn[]>(
    supabase,
    'pending_turn_notifications',
  );
  if (error) throw new Error(`pending_turn_notifications: ${error.message}`);

  const pending = data ?? [];
  report.due = pending.length;

  /**
   * Tell one player, by whichever channel they have.
   *
   * Push first and email only without it — see the note above. Returns
   * whether anything got through, so the caller knows whether to stamp the
   * row: an unstamped turn is retried, a stamped one is not.
   */
  const tell = async (
    turn: PendingTurn,
    kind: 'start' | 'warning',
  ): Promise<'push' | 'email' | 'skipped'> => {
    const devices = canPush ? (turn.push_targets ?? []) : [];

    if (devices.length > 0) {
      const results = await Promise.all(
        devices.map((device) =>
          sendPush(supabase, device, {
            title:
              kind === 'warning'
                ? 'Three hours left'
                : 'You’re on the clock',
            // Named by group, not just division. Somebody in two groups is
            // in a "Division 1" and a "Division 2" at once, and the division
            // alone doesn't say which one wants them.
            body:
              kind === 'warning'
                ? `${turn.league_name} · ${turn.division_name} — your picks are due soon.`
                : `${turn.league_name} · ${turn.division_name} — gameweek ${turn.gameweek}, you're up.`,
            url: '/draft',
            // One notification per turn per kind: a repeat replaces the
            // earlier one rather than stacking under it.
            tag: `${kind}-${turn.draft_id}`,
          }),
        ),
      );

      if (results.includes('sent')) return 'push';

      report.warnings.push(
        `${turn.email}: push failed on ${results.length} device${results.length === 1 ? '' : 's'} (${results.join(', ')}), fell back to email`,
      );
    }

    // A player with no real address yet.
    if (isPlaceholderEmail(turn.email)) return 'skipped';

    const sent = await sendEmail({
      to: turn.email,
      ...turnEmail({
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

    // No API key configured: leave it unstamped so it goes out once
    // notifications are switched on, rather than being lost.
    return sent ? 'email' : 'skipped';
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
