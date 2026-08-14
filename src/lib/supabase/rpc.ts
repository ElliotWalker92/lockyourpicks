import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/types';

/**
 * Call a Postgres function that isn't in the generated types yet.
 *
 * `src/lib/types/database.ts` is generated from the live schema, so a function
 * added in a migration that hasn't been applied — or applied but not
 * regenerated — isn't in the union `.rpc()` accepts. This keeps the cast in one
 * place rather than scattered at each call site.
 *
 * Cast the client, not the method: pulling `supabase.rpc` out into a local
 * loses its `this` binding and it fails on the client's internals instead.
 *
 * If a call returns "Could not find the function", the migration that defines
 * it hasn't been applied.
 */
export async function callRpc<T>(
  supabase: SupabaseClient<Database>,
  fn: string,
  args?: Record<string, unknown>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  const untyped = supabase as unknown as {
    rpc: (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: T | null; error: { message: string } | null }>;
  };
  return untyped.rpc(fn, args);
}
