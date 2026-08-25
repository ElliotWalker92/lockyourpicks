import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Read a server-side secret.
 *
 * Values set with `wrangler secret put` arrive as bindings on the Worker's
 * env, not as entries in `process.env`. Reading them the Node way works
 * perfectly under `next dev` — where .env.local populates process.env — and
 * returns undefined in production.
 *
 * That asymmetry is why every cron in this app was quietly returning
 * "CRON_SECRET is not configured" on the deployed Worker while passing
 * locally: nothing errored, the schedules fired, and each run was turned
 * away at the door. Nothing had ingested a result or opened a draft in
 * production since the day it was deployed.
 *
 * process.env first so local development and `next build` keep working,
 * then the binding.
 */
export function serverEnv(key: string): string | undefined {
  const fromNode = process.env[key];
  if (fromNode) return fromNode;

  try {
    const { env } = getCloudflareContext();
    return (env as unknown as Record<string, string | undefined>)?.[key];
  } catch {
    // Outside a request context (build, or a plain Node script).
    return undefined;
  }
}
