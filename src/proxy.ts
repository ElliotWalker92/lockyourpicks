import type { NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/session';

/**
 * Next 16 renamed the `middleware` convention to `proxy`.
 *
 * Runs on every request that isn't a static asset, refreshes the Supabase
 * session, and bounces signed-out users away from the authed routes.
 */
export function proxy(request: NextRequest) {
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
