import { NextResponse, type NextRequest } from 'next/server';

import { ingestFixtures } from '@/lib/ingest/fixtures';
import { createServiceRoleClient } from '@/lib/supabase/server';

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
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured' },
      { status: 500 },
    );
  }

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const report = await ingestFixtures(createServiceRoleClient());
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('ingest failed:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
