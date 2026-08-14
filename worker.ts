// Types declared in open-next-worker.d.ts — the module is a build artefact.
import nextHandler from './.open-next/worker.js';

/**
 * Worker entrypoint.
 *
 * OpenNext's generated worker exports only `fetch`. Cron triggers invoke
 * `scheduled`, so this wraps the generated handler and adds one, leaving the
 * request path completely untouched.
 *
 * The scheduled handler drives the existing route handlers rather than
 * importing the ingestion code directly: the routes already carry the auth
 * check, error handling and JSON reporting, and calling them through the Next
 * handler means cron and a manual curl take exactly the same path. It also
 * avoids resolving Next's `@/` path aliases outside the Next build.
 */

const ROUTES: Record<string, string> = {
  // Fixture list refresh — Tuesdays, just after a gameweek rolls over.
  '0 4 * * 2': '/api/cron/ingest',
  // Results and settlement.
  '*/15 * * * *': '/api/cron/results',
  // Open due drafts, and auto-pick turns whose clock has run out.
  '*/10 * * * *': '/api/cron/drafts',
};

const handler = {
  fetch: nextHandler.fetch,

  async scheduled(
    controller: ScheduledController,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    const path = ROUTES[controller.cron];
    if (!path) {
      console.error(`No route mapped for cron "${controller.cron}"`);
      return;
    }

    // The origin is irrelevant — this never leaves the Worker — but Request
    // demands an absolute URL.
    const request = new Request(`https://cron.internal${path}`, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });

    const response = await nextHandler.fetch(request, env, ctx);
    const body = await response.text();

    if (!response.ok) {
      console.error(`${path} failed: ${response.status} ${body.slice(0, 500)}`);
      return;
    }

    console.log(`${path}: ${body.slice(0, 500)}`);
  },
};

export default handler;
