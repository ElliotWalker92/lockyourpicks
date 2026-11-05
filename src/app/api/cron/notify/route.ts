import type { NextRequest } from 'next/server';

import { runCron } from '@/lib/cron';

import { emptyRoundReport, notifyRounds } from '@/lib/notify/rounds';
import { notifyTurns } from '@/lib/notify/turns';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Everything the app says to a person, on one schedule.
 *
 * "It's your turn" runs on the same cadence as the draft cron: a turn
 * opens the moment the previous player locks in, and ten minutes is close
 * enough to immediate for a draft measured in days. "Everyone's in" is
 * the same ten minutes after the last of them locks in, which for a
 * message nobody is waiting on is more than close enough.
 *
 * The round pass is caught rather than left to throw, so a fault in it
 * can't swallow the turn report that already succeeded — those emails
 * have gone out, and a run that says nothing about them is a run nobody
 * can audit.
 */
export async function GET(request: NextRequest) {
  return runCron(request, 'notify', async (supabase) => {
    const turns = await notifyTurns(supabase);

    let rounds = emptyRoundReport();
    try {
      rounds = await notifyRounds(supabase);
    } catch (err) {
      rounds.errors.push(err instanceof Error ? err.message : String(err));
    }

    return {
      ...turns,
      rounds: {
        due: rounds.due,
        sent: rounds.sent,
        pushed: rounds.pushed,
        skipped: rounds.skipped,
      },
      errors: [...turns.errors, ...rounds.errors],
      warnings: [...turns.warnings, ...rounds.warnings],
    };
  });
}
