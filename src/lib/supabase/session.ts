import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import type { Database } from '@/lib/types';

/**
 * Refreshes the auth session on every request and keeps the cookies in sync.
 *
 * `supabase.auth.getUser()` must be called here and its result must not be
 * skipped: it revalidates the token with Supabase. `getSession()` only reads
 * the cookie, which a client could have forged, so it is not safe to trust on
 * the server.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith('/auth');

  // API routes authenticate themselves — cron routes use a bearer secret, not a
  // session. Redirecting them to an HTML sign-in page would be wrong even for
  // the session-backed ones: an API caller wants a 401, not a 307 to a form.
  const isApiRoute = pathname.startsWith('/api');

  // The terms and the privacy policy have to be readable by someone who
  // has not signed up — that is exactly who reads them before deciding
  // to. A policy behind a login wall discloses nothing.
  const isLegalRoute = pathname.startsWith('/legal');

  // About and the invite links are marketing surface: they exist to be
  // read by people who do not have an account yet, and an invite that
  // bounces to a sign-in form with no explanation is an invite nobody
  // accepts.
  const isPublicRoute =
    pathname === '/' ||
    pathname === '/about' ||
    pathname.startsWith('/join/') ||
    isAuthRoute ||
    isApiRoute ||
    isLegalRoute;

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/sign-in';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Signed-in users have no business on the sign-in/sign-up forms. The
  // callback route is exempt — it's how a session gets established.
  if (user && isAuthRoute && !pathname.startsWith('/auth/callback')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
