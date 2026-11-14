import type { SupabaseClient } from '@supabase/supabase-js';

import { deliver } from '@/lib/notify/deliver';
import type { PushTarget } from '@/lib/notify/push';
import { callRpc } from '@/lib/supabase/rpc';
import type { Database } from '@/lib/types';

/**
 * "You picked a game that was already off — pick again."
 *
 * Only that case. A pick made while the game was genuinely on is not
 * released at all: it rides to the rearranged date and scores then (0063).
 * So everybody this writes to has lost a pick to stale data on our side,
 * which is worth saying plainly rather than dressing up as bad luck.
 *
 * The release itself happens in the database the moment a fixture goes
 * off, whoever wrote it (0062), and a trigger cannot send mail. So it
 * leaves a row saying who to tell, and this is what reads them.
 *
 * It rides the ten-minute draft pass rather than having a schedule of its
 * own: a Workers Free account gets five cron triggers and they were all
 * spoken for, and that pass is already the one that moves turns and tells
 * people about them.
 *
 * Marked as told only after something has gone out, so a mail outage
 * means a late notification rather than a silent one — the same way round
 * as the turn nudge, and for the same reason.
 */

export type ReleaseReport = {
  due: number;
  sent: number;
  pushed: number;
  skipped: number;
  errors: string[];
  warnings: string[];
};

type PendingRelease = {
  user_id: string;
  display_name: string | null;
  email: string;
  release_ids: string[];
  fixtures: string[];
  short: number;
  gameweek: number;
  closes_at: string;
  push_targets: PushTarget[] | null;
};

export function emptyReleaseReport(): ReleaseReport {
  return { due: 0, sent: 0, pushed: 0, skipped: 0, errors: [], warnings: [] };
}

export async function notifyReleases(
  supabase: SupabaseClient<Database>,
): Promise<ReleaseReport> {
  const report = emptyReleaseReport();

  const { data, error } = await callRpc<PendingRelease[]>(
    supabase,
    'pending_pick_releases',
  );
  if (error) throw new Error(`pending_pick_releases: ${error.message}`);

  const pending = data ?? [];
  report.due = pending.length;

  for (const row of pending) {
    try {
      const { how, warning } = await deliver(
        supabase,
        { email: row.email, push_targets: row.push_targets },
        {
          push: {
            title: 'That game was already off',
            body: `${list(row.fixtures)} ${
              row.fixtures.length === 1 ? 'was' : 'were'
            } already postponed. Pick again before ${closes(row.closes_at)}.`,
            url: '/draft',
            tag: `release-${row.gameweek}`,
          },
          mail: mail(row),
          headers: {
            'List-Unsubscribe': '<https://www.lockyourpicks.com/profile>',
          },
        },
      );

      if (warning) report.warnings.push(warning);
      if (how === 'skipped') {
        report.skipped++;
        continue;
      }

      await callRpc(supabase, 'mark_pick_releases_notified', {
        p_ids: row.release_ids,
      });

      report.sent++;
      if (how === 'push') report.pushed++;
    } catch (err) {
      report.errors.push(
        `${row.display_name ?? row.user_id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return report;
}

function mail(row: PendingRelease) {
  const many = row.short !== 1;
  const one = row.fixtures.length === 1;
  const body =
    `${list(row.fixtures)} had already been called off when ` +
    `you picked ${one ? 'it' : 'them'} — our fixture list hadn't caught up, ` +
    `which is our fault, not yours. You've got that pick back, so you're ` +
    `${row.short} short for gameweek ${row.gameweek}. Take ` +
    `${many ? `${row.short} more` : 'another one'} from the board before ` +
    `picking closes ${closes(row.closes_at)}. Leave it and the clock picks ` +
    `for you.`;

  return {
    subject: `Pick again — gameweek ${row.gameweek}`,
    text: `${body}\n\nhttps://lockyourpicks.com/draft`,
    html:
      `<p>${body}</p>` +
      `<p><a href="https://lockyourpicks.com/draft">Open the draft</a></p>`,
  };
}

function list(names: string[]) {
  if (names.length <= 1) return names[0] ?? 'A fixture';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function closes(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  });
}
