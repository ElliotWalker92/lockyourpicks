import type { NextRequest } from 'next/server';

import { runCron } from '@/lib/cron';
import { notifyShort } from '@/lib/notify/short';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * "You're a pick short and you can still fix it."
 *
 * Deliberately not on a schedule, even though it sits with the jobs that
 * are: there is no marker recording that somebody has been told, so a
 * ten-minute cron would send the same mail every ten minutes until the
 * deadline. It goes out when an admin runs it, after calling fixtures off.
 *
 * It uses `runCron` for the shared bearer-token guard and the run record,
 * not because anything calls it on a timer.
 */
export async function GET(request: NextRequest) {
  return runCron(request, 'short', (supabase) => notifyShort(supabase));
}
