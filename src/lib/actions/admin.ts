'use server';

import { revalidatePath } from 'next/cache';

import { callRpc } from '@/lib/supabase/rpc';
import { createClient } from '@/lib/supabase/server';

export type OpenNextState = {
  error: string | null;
  message: string | null;
};

/**
 * Start the next round for a group, ahead of the football finishing.
 *
 * Every check lives in the database function — ownership, and whether the
 * current round is actually finished — because this is a state change that
 * has to hold whoever calls it, not only this form.
 */
export async function openNextGameweek(
  _prev: OpenNextState,
  formData: FormData,
): Promise<OpenNextState> {
  const leagueId = String(formData.get('league_id') ?? '');
  if (!leagueId) return { error: 'Missing group.', message: null };

  const supabase = await createClient();
  const { data, error } = await callRpc<{
    opened: boolean;
    gameweek: number;
    message: string;
  }>(supabase, 'open_next_gameweek_for_league', { p_league_id: leagueId });

  if (error) return { error: error.message, message: null };

  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath('/dashboard');
  revalidatePath('/draft');
  return { error: null, message: data?.message ?? 'Done.' };
}
