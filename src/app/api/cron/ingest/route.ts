import type { NextRequest } from 'next/server';

import { runCron } from '@/lib/cron';

import { ingestFixtures } from '@/lib/ingest/fixtures';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Fixture ingestion. Intended to run on a schedule (weekly is plenty for
 * fixture lists; results need a separate, more frequent job).
 *
 * Guarded by a shared secret rather than a user session, because there is no
 * user — Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without this
 * the route would be an open trigger for several thousand upserts and a burst
 * of provider requests.
 */
export async function GET(request: NextRequest) {
  return runCron(request, 'ingest', (supabase) => ingestFixtures(supabase));
}
