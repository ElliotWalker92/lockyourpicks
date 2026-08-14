import { createBrowserClient } from '@supabase/ssr';

import type { Database } from '@/lib/types';

/**
 * Supabase client for Client Components.
 *
 * Only ever holds the anon key, and every table it can reach is governed by
 * RLS. Nothing here can write a pick — see `makePick` in
 * `src/lib/actions/picks.ts`, which goes through the database function.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
