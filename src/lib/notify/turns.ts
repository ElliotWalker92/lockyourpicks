import type { SupabaseClient } from '@supabase/supabase-js';

import { isPlaceholderEmail, sendEmail } from '@/lib/notify/resend';
import { turnEmail } from '@/lib/notify/turn-email';
import { callRpc } from '@/lib/supabase/rpc';
import type { Database } from '@/lib/types';

export type NotifyReport = {
  due: number;
  sent: number;
  skipped: number;
  errors: string[];
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
};

/**
 * Email whoever is on the clock and hasn't been told.
 *
 * Marked as notified only after the send succeeds, so a provider outage
 * means a delayed email rather than a silently skipped one. The cost of
 * that choice is a possible duplicate if the mark fails after the send —
 * which is the right way round: two emails is a nuisance, none is a player
 * getting auto-picked without warning.
 */
export async function notifyTurns(
  supabase: SupabaseClient<Database>,
): Promise<NotifyReport> {
  const report: NotifyReport = { due: 0, sent: 0, skipped: 0, errors: [] };

  const { data, error } = await callRpc<PendingTurn[]>(
    supabase,
    'pending_turn_notifications',
  );
  if (error) throw new Error(`pending_turn_notifications: ${error.message}`);

  const pending = data ?? [];
  report.due = pending.length;

  for (const turn of pending) {
    try {
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
