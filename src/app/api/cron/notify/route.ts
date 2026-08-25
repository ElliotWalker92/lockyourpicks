import { NextResponse, type NextRequest } from 'next/server';

import { notifyTurns } from '@/lib/notify/turns';
import { createServiceRoleClient } from '@/lib/supabase/server';

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
    const report = await notifyTurns(createServiceRoleClient());
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('turn notifications failed:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
