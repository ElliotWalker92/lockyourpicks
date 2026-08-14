import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/session';

/**
 * Session refresh and route guarding.
 *
 * Deliberately `middleware.ts` and not Next 16's `proxy.ts`, despite the
 * deprecation warning at build time.
 *
 * Proxy runs on the Node.js runtime and that isn't configurable — Next throws
 * if you try to set `runtime` in a proxy file. OpenNext can't run Node.js
 * middleware on Cloudflare Workers, so a proxy.ts build fails outright with
 * "Node.js middleware is not currently supported". Middleware still runs on the
 * edge runtime, which Workers does support.
 *
 * This can move to proxy.ts once OpenNext supports Node middleware. Until then
 * the deprecation warning is the cost of deploying to Cloudflare at all.
 *
 * It has to exist in some form: `@supabase/ssr` can't write cookies from a
 * Server Component, so this is the only place a refreshed access token is
 * persisted. Without it users are silently signed out when their token expires.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files — those don't need a
     * session refresh and matching them would just add latency.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
