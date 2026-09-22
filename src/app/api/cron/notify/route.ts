import type { NextRequest } from 'next/server';

import { runCron } from '@/lib/cron';

import { notifyTurns } from '@/lib/notify/turns';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * "It's your turn" emails.
 *
 * Runs on the same cadence as the draft cron: a turn opens the moment the
 * previous player locks in, and ten minutes is close enough to immediate
 * for a draft measured in days.
 */
export async function GET(request: NextRequest) {
  return runCron(request, 'notify', (supabase) => notifyTurns(supabase));
}
