import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { sendEmail } from '@/lib/notify/resend';
import { serverEnv } from '@/lib/server-env';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/types';

type Report = Record<string, unknown>;
type Client = SupabaseClient<Database>;

/**
 * One way to run a scheduled job, used by every cron route.
 *
 * The standings job answered HTTP 200 and `ok: true` for eight days while
 * every league it asked for was refused — the failures were in the body,
 * under `errors`, where nothing reads. So a run with any error is now a
 * failed run: `ok: false`, HTTP 500, a row in cron_status saying so, and —
 * once it has happened twice running — an email to the admins.
 *
 * Twice, not once: the provider rate-limits in bursts, and a single run
 * that loses one date to that and recovers on the next is not something
 * anyone needs woken up for. Two in a row is a pattern.
 */
export async function runCron(
  request: NextRequest,
  job: string,
  run: (supabase: Client) => Promise<Report>,
) {
  const secret = serverEnv('CRON_SECRET');
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured' },
      { status: 500 },
    );
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  let report: Report = {};
  let errors: string[];

  try {
    report = await run(supabase);
    errors = errorsIn(report);
  } catch (err) {
    errors = [err instanceof Error ? err.message : String(err)];
  }

  const ok = errors.length === 0;
  if (!ok) console.error(`${job}:`, errors.join(' | '));

  // Recording the run must never be what fails it.
  try {
    await recordRun(supabase, job, ok, errors);
  } catch (err) {
    console.error(`${job}: could not record run:`, err);
  }

  return NextResponse.json(
    { ok, ...report, errors },
    { status: ok ? 200 : 500 },
  );
}

/**
 * Every failure a report describes, wherever it put it.
 *
 * Most jobs keep a top-level `errors`; the fixture import reports per
 * competition instead. Both count — and `warnings` deliberately doesn't.
 *
 * The provider's minute ceiling looks to be enforced per IP, and Workers
 * share outbound addresses, so a job can be refused because of somebody
 * else's traffic and be perfectly fine on the next run. Ten such refusals
 * in a row sent ten emails about nothing while every result was in and
 * every table current. A job is now judged by whether its data is behind:
 * results checks for a match played without a result, standings for a
 * table that hasn't moved in a day.
 */
function errorsIn(report: Report): string[] {
  const found: string[] = [];
  if (Array.isArray(report.errors)) found.push(...report.errors.map(String));
  if (Array.isArray(report.competitions)) {
    for (const c of report.competitions as { code?: string; error?: string }[]) {
      if (c?.error) found.push(`${c.code ?? '?'}: ${c.error}`);
    }
  }
  return found;
}

const ALERT_AFTER_FAILURES = 2;
const REALERT_AFTER_MS = 24 * 3_600_000;

async function recordRun(
  supabase: Client,
  job: string,
  ok: boolean,
  errors: string[],
) {
  // cron_status arrives in migration 0024 and isn't in the generated types,
  // so this one table goes through an untyped client.
  const table = (supabase as unknown as SupabaseClient).from('cron_status');

  const { data: prevRow } = await table.select('*').eq('job', job).maybeSingle();
  const prev = prevRow as {
    failures: number;
    failing_since: string | null;
    alerted_at: string | null;
  } | null;

  const now = new Date();
  const failures = ok ? 0 : (prev?.failures ?? 0) + 1;
  const failingSince = ok ? null : (prev?.failing_since ?? now.toISOString());
  let alertedAt = ok ? null : (prev?.alerted_at ?? null);

  if (
    !ok &&
    failures >= ALERT_AFTER_FAILURES &&
    (!alertedAt || now.getTime() - new Date(alertedAt).getTime() > REALERT_AFTER_MS)
  ) {
    if (await tellAdmins(supabase, failingMail(job, errors, failingSince!))) {
      alertedAt = now.toISOString();
    }
  }

  // Say so when it mends, but only if we'd said it was broken.
  if (ok && prev?.alerted_at) {
    await tellAdmins(supabase, recoveredMail(job));
  }

  await table.upsert({
    job,
    last_run_at: now.toISOString(),
    last_ok: ok,
    last_errors: errors.slice(0, 20),
    failures,
    failing_since: failingSince,
    alerted_at: alertedAt,
  });
}

async function tellAdmins(
  supabase: Client,
  mail: { subject: string; text: string },
): Promise<boolean> {
  const { data: admins } = await supabase
    .from('profiles')
    .select('id')
    .eq('is_admin', true);

  let sent = false;
  for (const admin of admins ?? []) {
    const { data } = await supabase.auth.admin.getUserById(admin.id);
    const to = data.user?.email;
    if (!to) continue;
    const html = `<pre style="font:14px/1.5 ui-monospace,monospace;white-space:pre-wrap">${escape(mail.text)}</pre>`;
    if (await sendEmail({ to, subject: mail.subject, text: mail.text, html })) {
      sent = true;
    }
  }
  return sent;
}

function failingMail(job: string, errors: string[], since: string) {
  return {
    subject: `Lock Your Picks: the ${job} job is failing`,
    text: [
      `The scheduled ${job} job has failed on its last few runs, since ${new Date(since).toUTCString()}.`,
      '',
      'Most recent errors:',
      ...errors.slice(0, 10).map((e) => `  - ${e}`),
      '',
      "You'll get this at most once a day while it keeps failing, and one more when it recovers.",
    ].join('\n'),
  };
}

function recoveredMail(job: string) {
  return {
    subject: `Lock Your Picks: the ${job} job has recovered`,
    text: `The scheduled ${job} job ran cleanly again at ${new Date().toUTCString()}.`,
  };
}

function escape(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}
