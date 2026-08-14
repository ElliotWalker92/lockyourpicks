import { NextResponse, type NextRequest } from 'next/server';

import { ingestResults } from '@/lib/ingest/results';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

  try {
    const report = await ingestResults(createServiceRoleClient());
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('results ingest failed:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
