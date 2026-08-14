import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext adapter config.
 *
 * No incremental cache is configured: every page in this app is dynamic — the
 * draft board, tables and dashboard all read per-user state — so there is
 * nothing worth caching between requests, and an R2 or KV cache would be pure
 * overhead.
 */
export default defineCloudflareConfig();
