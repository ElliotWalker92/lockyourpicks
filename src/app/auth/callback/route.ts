import { NextResponse, type NextRequest } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Email-confirmation and magic-link landing point.
 *
 * Supabase redirects here with a `code`; exchanging it sets the session
 * cookies, after which the user is a normal signed-in visitor.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    // Nearly always a link that has already been used or has expired.
    return NextResponse.redirect(`${origin}/auth/sign-in?error=expired`);
  }

  // Arriving with no code at all means the link never carried one — the
  // usual cause is the redirect URL not being allowed by the auth project,
  // which silently replaces it with the site URL and drops the query.
  return NextResponse.redirect(`${origin}/auth/sign-in?error=link`);
}
