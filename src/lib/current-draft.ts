import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/types';

export type DraftGameweek = {
  id: string;
  number: number;
  name: string | null;
  draft_opens_at: string;
  draft_closes_at: string;
  status: string;
};

export type CurrentDraft = {
  id: string;
  status: 'pending' | 'active' | 'complete';
  pick_order: string[];
  picks_per_player: number;
  current_turn: number;
  turn_expires_at: string | null;
};

const GAMEWEEK_COLUMNS =
  'id, number, name, draft_opens_at, draft_closes_at, status';

const DRAFT_COLUMNS =
  'id, status, pick_order, picks_per_player, current_turn, turn_expires_at';

/**
 * The gameweek a division is currently concerned with, and its draft.
 *
 * The running draft wins over the calendar. Drafting can start early — a
 * gameweek settling ahead of schedule opens the next one there and then — so
 * a page that decides what to show from `draft_opens_at` alone will insist
 * nothing is happening while the board is live. That is exactly what split
 * the dashboard from the picks page: one read the calendar, the other read
 * the draft, and they disagreed in front of the player.
 *
 * Both now ask this, so they cannot drift apart again.
 *
 * Order of preference:
 *   1. an active draft whose deadline hasn't passed — the live one
 *   2. whatever the calendar says is open
 *   3. the next gameweek due
 */
export async function currentDraftFor(
  supabase: SupabaseClient<Database>,
  divisionId: string,
): Promise<{ gameweek: DraftGameweek | null; draft: CurrentDraft | null }> {
  const nowIso = new Date().toISOString();

  // 1. Live draft.
  const { data: active } = await supabase
    .from('drafts')
    .select(`${DRAFT_COLUMNS}, gameweeks!inner(${GAMEWEEK_COLUMNS})`)
    .eq('division_id', divisionId)
    .eq('status', 'active')
    .gt('gameweeks.draft_closes_at', nowIso)
    .order('number', { referencedTable: 'gameweeks', ascending: true })
    .limit(1)
    .maybeSingle();

  if (active) {
    const { gameweeks, ...draft } = active as unknown as CurrentDraft & {
      gameweeks: DraftGameweek | DraftGameweek[];
    };
    const gameweek = Array.isArray(gameweeks) ? gameweeks[0] : gameweeks;
    return { gameweek, draft };
  }

  // 2. The calendar's open window, else 3. the next one due.
  const { data: open } = await supabase
    .from('gameweeks')
    .select(GAMEWEEK_COLUMNS)
    .lte('draft_opens_at', nowIso)
    .gt('draft_closes_at', nowIso)
    .order('number')
    .limit(1)
    .maybeSingle();

  const gameweek =
    open ??
    (
      await supabase
        .from('gameweeks')
        .select(GAMEWEEK_COLUMNS)
        .gt('draft_closes_at', nowIso)
        .order('number')
        .limit(1)
        .maybeSingle()
    ).data;

  if (!gameweek) return { gameweek: null, draft: null };

  const { data: draft } = await supabase
    .from('drafts')
    .select(DRAFT_COLUMNS)
    .eq('division_id', divisionId)
    .eq('gameweek_id', gameweek.id)
    .maybeSingle();

  return {
    gameweek: gameweek as DraftGameweek,
    draft: (draft as CurrentDraft | null) ?? null,
  };
}
