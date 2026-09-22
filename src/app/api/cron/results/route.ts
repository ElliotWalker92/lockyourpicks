import type { NextRequest } from 'next/server';

import { runCron } from '@/lib/cron';

import { ingestResults } from '@/lib/ingest/results';

export const dynamic = 'force-dynamic';
// Up to fourteen dates, any of which may wait out a per-minute ceiling.
export const maxDuration = 180;

/**
 * Results polling and settlement.
 *
 * Meant to run frequently while matches are on — every 10 minutes through a
 * Saturday is reasonable — and harmlessly often otherwise. Both the fixture
 * updates and `settle_due_gameweeks` are idempotent, so a double-fire costs a
 * few requests and changes nothing.
 *
 * Same bearer-secret guard as the ingest route: there's no user here.
 */
export async function GET(request: NextRequest) {
  return runCron(request, 'results', (supabase) => ingestResults(supabase));
}
