import { NextResponse, type NextRequest } from 'next/server';

import { serverEnv } from '@/lib/server-env';

import { recomputeElo } from '@/lib/ingest/elo';
import { createServiceRoleClient } from '@/lib/supabase/server';

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
  const secret = serverEnv('CRON_SECRET');
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
    const report = await recomputeElo(createServiceRoleClient());
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('elo recompute failed:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
