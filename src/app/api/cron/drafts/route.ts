import type { NextRequest } from 'next/server';

import { runCron } from '@/lib/cron';

import { callRpc } from '@/lib/supabase/rpc';
import { emptyReleaseReport, notifyReleases } from '@/lib/notify/releases';
import { emptyRoundReport, notifyRounds } from '@/lib/notify/rounds';
import { notifyTurns } from '@/lib/notify/turns';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Draft lifecycle: open drafts that are due, and unstick ones that have stalled.
 *
 * Two jobs, one schedule, because they're the same concern — keeping drafts
 * moving without anyone intervening:
 *
 *   open_due_drafts    opens a draft per division for any gameweek inside its
 *                      drafting window. Previously an admin pressed a button,
 *                      which cannot run a season.
 *
 *   run_expired_turns  auto-picks for turns whose clock has run out. Without
 *                      this a draft stops dead the moment one player goes
 *                      quiet, and everyone behind them is blocked — the whole
 *                      point of having a turn deadline is that something
 *                      enforces it.
 *
 *   auto_pick_shortfalls
 *                      fills anyone still short once picking has closed.
 *                      run_expired_turns above only ever fills the seat on
 *                      the clock, so a player whose pick was given back by
 *                      a postponement and who never acted on it used to go
 *                      into the weekend a pick down — see 0062.
 *
 *   notifyReleases     tells whoever had a pick given back because their
 *                      fixture went off. The release happens in the
 *                      database the moment the status moves, whoever wrote
 *                      it; this is the half a trigger cannot do.
 *
 *   notifyTurns        tells whoever the clock has just moved to — a push to
 *                      their phone if they've installed the app, an email
 *                      otherwise. It rides here rather than on its own
 *                      schedule for two reasons: this is the job that changes
 *                      whose turn it is, so the notification goes out in the
 *                      same pass; and a Workers Free account gets five cron
 *                      triggers, all of which were already spoken for.
 *
 *   notifyRounds       tells whoever runs a group that its gameweek has
 *                      finished drafting. Here for the same two reasons, and
 *                      a third: run_expired_turns above is one of the two
 *                      ways a round finishes, so the pass that completes it
 *                      is the pass that should say so.
 *
 * All four are idempotent, so overlapping runs are harmless.
 */
export async function GET(request: NextRequest) {
  return runCron(request, 'drafts', async (supabase) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const { data: opened, error: openError } = await callRpc<number>(
      supabase,
      'open_due_drafts',
    );
    if (openError) errors.push(`open_due_drafts: ${openError.message}`);

    const { data: autoPicked, error: turnError } = await callRpc<number>(
      supabase,
      'run_expired_turns',
    );
    if (turnError) errors.push(`run_expired_turns: ${turnError.message}`);

    // After the turns, because a turn expiring is one of the ways a round
    // ends up short, and before the notifications, so nobody is told to
    // pick again for a round that has just closed under them.
    const { data: filled, error: fillError } = await callRpc<number>(
      supabase,
      'auto_pick_shortfalls',
    );
    if (fillError) errors.push(`auto_pick_shortfalls: ${fillError.message}`);

    let releases = emptyReleaseReport();
    try {
      releases = await notifyReleases(supabase);
    } catch (err) {
      releases.errors.push(
        `notifyReleases: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    errors.push(...releases.errors);
    warnings.push(...releases.warnings);

    // After the turns have moved, not before.
    let notified = { due: 0, sent: 0, pushed: 0, warned: 0, skipped: 0 };
    try {
      const report = await notifyTurns(supabase);
      notified = {
        due: report.due,
        sent: report.sent,
        pushed: report.pushed,
        warned: report.warned,
        skipped: report.skipped,
      };
      errors.push(...report.errors);
      warnings.push(...report.warnings);
    } catch (err) {
      // A mail failure must not stop drafts opening or turns expiring.
      errors.push(
        `notifyTurns: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Likewise: a round that can't be announced must not fail the job that
    // opened the next one.
    let rounds = emptyRoundReport();
    try {
      rounds = await notifyRounds(supabase);
    } catch (err) {
      rounds.errors.push(
        `notifyRounds: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    errors.push(...rounds.errors);
    warnings.push(...rounds.warnings);

    return {
      draftsOpened: opened ?? 0,
      turnsAutoPicked: autoPicked ?? 0,
      shortfallsFilled: filled ?? 0,
      releases: {
        due: releases.due,
        sent: releases.sent,
        pushed: releases.pushed,
        skipped: releases.skipped,
      },
      notified,
      rounds: {
        due: rounds.due,
        sent: rounds.sent,
        pushed: rounds.pushed,
        skipped: rounds.skipped,
      },
      errors,
      warnings,
    };
  });
}
