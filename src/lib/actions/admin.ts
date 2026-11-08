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

export type AdminState = { error: string | null; success: string | null };

/**
 * Call a fixture off, or put it back on.
 *
 * The provider is slow on EFL postponements — five League One games in
 * gameweek 23 were called off for international call-ups and still read
 * as "not started" days later, so the board kept offering games that
 * will not be played. Waiting for the data to catch up is not a plan
 * when the draft closes on Saturday morning.
 *
 * Everything that matters happens in `admin_set_fixture_status`: the
 * admin check, the status, and releasing any picks on it. This is the
 * thin wrapper that lets a button call it, and it is deliberately thin —
 * a check written here would be a suggestion, since a server action is a
 * public endpoint.
 */
export async function setFixtureStatus(
  fixtureId: string,
  status: 'scheduled' | 'postponed' | 'cancelled',
): Promise<AdminState> {
  const supabase = await createClient();

  const { data, error } = await callRpc<number>(
    supabase,
    'admin_set_fixture_status',
    { p_fixture_id: fixtureId, p_status: status },
  );

  if (error) return { error: error.message, success: null };

  const released = data ?? 0;
  const note =
    status === 'scheduled'
      ? 'Back on the board.'
      : released === 0
        ? 'Taken off the board.'
        : `Taken off the board, and ${released} pick${
            released === 1 ? '' : 's'
          } released — those players can pick again.`;

  revalidatePath('/draft');
  return { error: null, success: note };
}
