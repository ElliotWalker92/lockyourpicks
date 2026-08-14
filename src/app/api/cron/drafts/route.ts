import { NextResponse, type NextRequest } from 'next/server';

import { callRpc } from '@/lib/supabase/rpc';
import { createServiceRoleClient } from '@/lib/supabase/server';

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
 * Both are idempotent, so overlapping runs are harmless.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured' },
      { status: 500 },
    );
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const errors: string[] = [];

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

  const body = {
    ok: errors.length === 0,
    draftsOpened: opened ?? 0,
    turnsAutoPicked: autoPicked ?? 0,
    errors,
  };

  if (errors.length > 0) console.error('drafts cron:', errors.join(' | '));

  return NextResponse.json(body, { status: errors.length > 0 ? 500 : 200 });
}
