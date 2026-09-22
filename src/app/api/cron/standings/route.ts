import type { NextRequest } from 'next/server';

import { runCron } from '@/lib/cron';

import { ingestStandings } from '@/lib/ingest/standings';

export const dynamic = 'force-dynamic';
// Four competitions, each of which may wait out a per-minute ceiling.
export const maxDuration = 120;

/**
 * League tables.
 *
 * Four provider calls a run, and the tables only move when matches finish,
 * so a few times a day is plenty. Same bearer-secret guard as the other
 * cron routes: there's no user here.
 */
export async function GET(request: NextRequest) {
  return runCron(request, 'standings', (supabase) => ingestStandings(supabase));
}
