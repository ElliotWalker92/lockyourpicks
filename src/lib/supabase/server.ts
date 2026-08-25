import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

import { serverEnv } from '@/lib/server-env';
import type { Database } from '@/lib/types';

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Must be created per-request — never hoisted to a module-level singleton, or
 * one user's session would leak into another's request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Session refresh is handled by middleware instead, so this is safe
            // to swallow.
          }
        },
      },
    },
  );
}

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for trusted server-side jobs — fixture ingestion, settling gameweeks.
 * Never import this into anything that renders, and never expose its results
 * to a client without filtering them yourself: RLS is not there to help you
 * here.
 */
export function createServiceRoleClient() {
  const key = serverEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    {
      cookies: { getAll: () => [], setAll: () => {} },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
