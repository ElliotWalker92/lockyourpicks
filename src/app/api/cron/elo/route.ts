import type { NextRequest } from 'next/server';

import { runCron } from '@/lib/cron';

import { recomputeElo } from '@/lib/ingest/elo';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Recompute every team's Elo rating.
 *
 * Weekly is plenty — ratings move slowly and the job replays all of history
 * each run, so there is nothing to accumulate between runs. It is safe to
 * trigger by hand at any time.
 */
export async function GET(request: NextRequest) {
  return runCron(request, 'elo', (supabase) => recomputeElo(supabase));
}
