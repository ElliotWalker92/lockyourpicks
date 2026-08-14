'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import type { DraftPick, Outcome } from '@/lib/types';

export type MakePickResult =
  | { ok: true; pick: DraftPick }
  | { ok: false; error: string };

/**
 * Claim a fixture and stake a prediction on it, in one turn.
 *
 * All the real work happens in the `make_pick` database function: it takes a
 * row lock on the draft, checks that it is genuinely your turn, that the turn
 * has not expired, that the fixture is in this gameweek and has not kicked off,
 * and that nobody in your division has already taken it — then inserts. This
 * action is only a typed wrapper.
 *
 * Deliberately no validation duplicated here. A second copy of the rules on the
 * client is a copy that drifts, and it would be trivially bypassable anyway.
 */
export async function makePick(
  draftId: string,
  fixtureId: string,
  outcome: Outcome,
): Promise<MakePickResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'You need to be signed in to pick.' };
  }

  const { data, error } = await supabase.rpc('make_pick', {
    p_draft_id: draftId,
    p_fixture_id: fixtureId,
    p_outcome: outcome,
  });

  if (error) {
    // The function raises human-readable messages ("It is not your turn to
    // pick", "That fixture has already been taken in this draft"), so they are
    // worth surfacing as-is rather than flattening to something generic.
    return { ok: false, error: error.message };
  }

  revalidatePath('/draft');
  return { ok: true, pick: data as DraftPick };
}
