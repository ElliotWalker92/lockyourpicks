'use server';

import { revalidatePath } from 'next/cache';

import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

export type DraftActionState = { error: string | null };

/**
 * Open a draft for every division, for the given gameweek.
 *
 * Wraps `start_drafts_for_gameweek`, which is revoked from `authenticated` —
 * opening drafts sets turn order and deadlines for everyone, so it runs with
 * the service role behind an explicit admin check rather than being exposed as
 * an RPC players could call.
 *
 * In production this belongs on a schedule. The button exists so a draft can be
 * opened on demand while the season is being set up.
 */
export async function openDrafts(
  _prev: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const gameweekId = String(formData.get('gameweek_id') ?? '');
  if (!gameweekId) return { error: 'Missing gameweek.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You need to be signed in.' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (!profile?.is_admin) {
    return { error: 'Only an admin can open drafts.' };
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.rpc('start_drafts_for_gameweek', {
    p_gameweek_id: gameweekId,
  });

  if (error) return { error: error.message };

  revalidatePath('/draft');
  return { error: null };
}
