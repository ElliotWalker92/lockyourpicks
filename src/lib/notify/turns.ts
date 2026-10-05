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

  for (const turn of pending) {
    try {
      const devices = canPush ? (turn.push_targets ?? []) : [];

      if (devices.length > 0) {
        const results = await Promise.all(
          devices.map((device) =>
            sendPush(supabase, device, {
              title: 'You’re on the clock',
              body: `Gameweek ${turn.gameweek} — pick your three in ${turn.division_name}.`,
              url: '/draft',
              // One notification per turn: a second push for the same turn
              // replaces the first rather than stacking under it.
              tag: `turn-${turn.draft_id}`,
            }),
          ),
        );

        if (results.includes('sent')) {
          await callRpc(supabase, 'mark_turn_notified', {
            p_draft_id: turn.draft_id,
          });
          report.sent++;
          report.pushed++;
          continue;
        }
        // Every device refused. Fall through to email — and say so, since
        // otherwise a player whose phone has quietly stopped receiving
        // looks indistinguishable from one who never installed the app.
        report.warnings.push(
          `${turn.email}: push failed on ${results.length} device${results.length === 1 ? '' : 's'} (${results.join(', ')}), fell back to email`,
        );
      }

      // A player with no real address yet: marked as notified so it isn't
      // retried every ten minutes, and counted as skipped, not sent.
      if (isPlaceholderEmail(turn.email)) {
        await callRpc(supabase, 'mark_turn_notified', {
          p_draft_id: turn.draft_id,
        });
        report.skipped++;
        continue;
      }

      const email = turnEmail({
        name: turn.display_name ?? 'there',
        division: turn.division_name,
        league: turn.league_name,
        gameweek: turn.gameweek,
        expiresAt: turn.expires_at,
      });

      const sent = await sendEmail({
        to: turn.email,
        ...email,
        // Mailbox providers — Outlook especially — treat a message you
        // can't opt out of as more likely to be unwanted, and some will
        // surface a one-tap unsubscribe instead of leaving junk as the
        // only option. The switch it points at is real: Profile has
        // "Email me when it's my turn".
        headers: {
          'List-Unsubscribe': '<https://www.lockyourpicks.com/profile>',
        },
      });
      if (!sent) {
        // No API key configured: leave it unmarked so it goes out once
        // notifications are switched on, rather than being lost.
        report.skipped++;
        continue;
      }

      await callRpc(supabase, 'mark_turn_notified', {
        p_draft_id: turn.draft_id,
      });
      report.sent++;
    } catch (err) {
      report.errors.push(
        `${turn.email}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return report;
}
