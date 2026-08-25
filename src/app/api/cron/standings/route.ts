import { NextResponse, type NextRequest } from 'next/server';

import { ingestStandings } from '@/lib/ingest/standings';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * League tables.
 *
 * Four provider calls a run, and the tables only move when matches finish,
 * so a few times a day is plenty. Same bearer-secret guard as the other
 * cron routes: there's no user here.
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
    const report = await ingestStandings(createServiceRoleClient());
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('standings ingest failed:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
