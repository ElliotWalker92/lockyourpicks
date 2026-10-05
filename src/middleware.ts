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
     *
     * The install files are excluded for a stronger reason than latency:
     * the browser fetches the manifest and the service worker with no
     * session, and this middleware answers an unauthenticated request with
     * a redirect to sign-in. A 307 where a script or a manifest should be
     * is not an error anyone sees — the app simply never becomes
     * installable, and the offline page never arrives.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline|offline.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)',
  ],
};
