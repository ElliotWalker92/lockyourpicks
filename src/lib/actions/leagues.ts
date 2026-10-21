'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { picksForDivisionSize } from '@/lib/division-shape';
import { callRpc } from '@/lib/supabase/rpc';
import { createClient } from '@/lib/supabase/server';

export type LeagueState = { error: string | null };

/** Ambiguity-free alphabet — no O/0, I/1, so codes survive being read aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateJoinCode(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(
    '',
  );
}

export async function createLeague(
  _prev: LeagueState,
  formData: FormData,
): Promise<LeagueState> {
  const name = String(formData.get('name') ?? '').trim();
  const divisionSize = Number(formData.get('division_size') ?? 3);

  if (!name) return { error: 'Give your league a name.' };
  if (!Number.isInteger(divisionSize) || divisionSize < 2 || divisionSize > 10) {
    return { error: 'Division size must be between 2 and 10.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You need to be signed in.' };

  // A league is not tied to a season — it persists, and its divisions are
  // rearranged each year by promotion and relegation.
  //
  // Retry on the (vanishingly unlikely) join-code collision rather than
  // failing the whole action — the unique index is what actually guarantees
  // uniqueness, so we just need another go.
  let leagueId: string | null = null;
  for (let attempt = 0; attempt < 5 && !leagueId; attempt++) {
    const { data, error } = await supabase
      .from('leagues')
      .insert({
        name,
        join_code: generateJoinCode(),
        owner_id: user.id,
        division_size: divisionSize,
        // The picks follow from the size and are stored, not derived on
        // read, because drafts copy the number as they open. Leaving it to
        // the column default gave a new group of five three picks each —
        // fifteen fixtures a week, which no gameweek this season carries.
        picks_per_player: picksForDivisionSize(divisionSize),
      })
      .select('id')
      .single();

    if (data) leagueId = data.id;
    else if (error && error.code !== '23505') return { error: error.message };
  }

  if (!leagueId) {
    return { error: 'Could not generate a unique join code. Try again.' };
  }

  const { error: memberError } = await supabase
    .from('league_members')
    .insert({ league_id: leagueId, user_id: user.id });

  if (memberError) return { error: memberError.message };

  // The English core arrives with the league, seeded by trigger (0042), so
  // this only ever adds the extras. A failure here is worth reporting but
  // not worth losing the league over — the group exists and plays the core,
  // which is the game; the owner can tick the extras again on its page.
  const extras = formData
    .getAll('competition_id')
    .map((v) => String(v))
    .filter(Boolean);

  if (extras.length > 0) {
    const { error: compError } = await callRpc(
      supabase,
      'set_league_competitions',
      { p_league_id: leagueId, p_competition_ids: extras },
    );
    if (compError) {
      console.error('createLeague: competitions', compError.message);
    }
  }

  revalidatePath('/leagues');
  redirect(`/leagues/${leagueId}`);
}

export async function joinLeague(
  _prev: LeagueState,
  formData: FormData,
): Promise<LeagueState> {
  const code = String(formData.get('join_code') ?? '')
    .trim()
    .toUpperCase();

  if (!code) return { error: 'Enter a join code.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You need to be signed in.' };

  const { data: league } = await supabase
    .from('leagues')
    .select('id, is_open')
    .eq('join_code', code)
    .maybeSingle();

  if (!league || league.is_open) {
    return { error: 'No league with that code. Check it and try again.' };
  }

  // A player drafts in one pool. Three picks a round is the game, so an open
  // place has to be given up before taking a private one — otherwise they'd
  // owe six picks and two turns, and gameweek_scores can only hold one score
  // per week anyway.
  const { error: leaveError } = await callRpc<boolean>(
    supabase,
    'leave_open_league',
  );
  if (leaveError) return { error: leaveError.message };

  const { error } = await supabase
    .from('league_members')
    .upsert(
      { league_id: league.id, user_id: user.id },
      { onConflict: 'league_id,user_id', ignoreDuplicates: true },
    );

  if (error) return { error: error.message };

  revalidatePath('/leagues');
  redirect(`/leagues/${league.id}`);
}

/**
 * Take a place in the open league.
 *
 * No join code, no waiting on an owner to arrange divisions: the database
 * fills the bottom division and opens a new one when it's full, so a player
 * who knows nobody still drafts against real opponents rather than picking
 * freely from an unclaimed board.
 */
export async function joinOpenLeague(
  _prev: LeagueState,
  _formData: FormData,
): Promise<LeagueState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You need to be signed in.' };

  const { error } = await callRpc<string>(supabase, 'join_open_league');
  if (error) return { error: error.message };

  revalidatePath('/leagues');
  revalidatePath('/dashboard');
  redirect('/dashboard');
}

/**
 * Split the league's members into divisions of `division_size`.
 *
 * Tier 1 is the top division. Members are allocated in join order, which is
 * arbitrary for a first season — after that, promotion and relegation decide
 * who sits where, so this is only ever the opening arrangement.
 *
 * Rebuilds from scratch each time, so it's safe to re-run after someone joins.
 */
export async function buildDivisions(
  _prev: LeagueState,
  formData: FormData,
): Promise<LeagueState> {
  const leagueId = String(formData.get('league_id') ?? '');
  if (!leagueId) return { error: 'Missing league.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You need to be signed in.' };

  const { data: league } = await supabase
    .from('leagues')
    .select('id, owner_id, division_size')
    .eq('id', leagueId)
    .single();

  if (!league) return { error: 'League not found.' };
  if (league.owner_id !== user.id) {
    return { error: 'Only the league owner can arrange divisions.' };
  }

  // Players only. A viewer is in the group to watch it, and putting them in
  // a division would hand them picks to owe and a turn to miss.
  const { data: members } = await supabase
    .from('league_members')
    .select('user_id, joined_at')
    .eq('league_id', leagueId)
    .eq('role', 'player')
    .order('joined_at', { ascending: true });

  if (!members?.length) return { error: 'This league has no members yet.' };

  // Divisions are per-season: this arranges the active season only, leaving
  // previous seasons' tables intact.
  const { data: season } = await supabase
    .from('seasons')
    .select('id')
    .eq('is_active', true)
    .maybeSingle();

  if (!season) {
    return {
      error:
        'No active season. Run migration 0004 in the Supabase SQL editor first.',
    };
  }

  const size = league.division_size;
  const divisionCount = Math.ceil(members.length / size);

  if (members.length % size !== 0) {
    return {
      error: `${members.length} players don't divide evenly into divisions of ${size}. Adjust the division size or wait for more players.`,
    };
  }

  // Clear this season's arrangement only. Cascades to division_members.
  const { error: clearError } = await supabase
    .from('divisions')
    .delete()
    .eq('league_id', leagueId)
    .eq('season_id', season.id);
  if (clearError) return { error: clearError.message };

  for (let tier = 1; tier <= divisionCount; tier++) {
    const { data: division, error: divisionError } = await supabase
      .from('divisions')
      .insert({
        league_id: leagueId,
        season_id: season.id,
        name: `Division ${tier}`,
        tier,
      })
      .select('id')
      .single();

    if (divisionError || !division) {
      return { error: divisionError?.message ?? 'Could not create division.' };
    }

    const slice = members.slice((tier - 1) * size, tier * size);
    const { error: assignError } = await supabase
      .from('division_members')
      .insert(
        slice.map((m) => ({
          division_id: division.id,
          user_id: m.user_id,
          league_id: leagueId,
          season_id: season.id,
        })),
      );

    if (assignError) return { error: assignError.message };
  }

  revalidatePath(`/leagues/${leagueId}`);
  return { error: null };
}

/**
 * Set how many play in a division.
 *
 * Only the size is chosen. How many fixtures each player takes follows from
 * it — see picks_for_division_size in migration 0029 — because the two
 * multiply against a fixture list the owner can't see, and a group of six
 * taking three each cannot run at all.
 *
 * The checking is all in `set_division_size`: ownership, the range, the
 * product against the real fixture floor, and whether a division has
 * already grown past the size being asked for. Doing it there keeps it true
 * for anything that calls it, and keeps the answer beside the data it is
 * checked against.
 */
export async function setDivisionSize(
  _prev: { error: string | null; success: string | null },
  formData: FormData,
): Promise<{ error: string | null; success: string | null }> {
  const leagueId = String(formData.get('league_id') ?? '');
  const size = Number(formData.get('division_size'));

  if (!leagueId) return { error: 'Missing group.', success: null };

  const supabase = await createClient();
  const { data, error } = await callRpc<{ picks_per_player: number }>(
    supabase,
    'set_division_size',
    { p_league_id: leagueId, p_division_size: size },
  );

  if (error) return { error: error.message, success: null };

  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath('/dashboard');

  const picks = data?.picks_per_player ?? 0;
  return {
    error: null,
    success: `Saved — ${size} per division, ${picks} pick${picks === 1 ? '' : 's'} each.`,
  };
}

/**
 * Undo the picks the clock made.
 *
 * All the judgement is in `rollback_auto_picks`: ownership, which round is
 * still open, whether the football has started, which seat to rewind each
 * division to, and leaving real picks alone. Keeping it there means the
 * rule is the same wherever it is called from, and the decision sits beside
 * the rows it is made about.
 */
export async function undoAutoPicks(
  _prev: { error: string | null; success: string | null },
  formData: FormData,
): Promise<{ error: string | null; success: string | null }> {
  const leagueId = String(formData.get('league_id') ?? '');
  if (!leagueId) return { error: 'Missing group.', success: null };

  const supabase = await createClient();
  const { data, error } = await callRpc<{ message: string }>(
    supabase,
    'rollback_auto_picks',
    { p_league_id: leagueId },
  );

  if (error) return { error: error.message, success: null };

  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath('/dashboard');
  revalidatePath('/draft');
  return { error: null, success: data?.message ?? 'Done.' };
}

/**
 * Which competitions the group plays.
 *
 * The form posts the extras it wants ticked; the core is not in the form at
 * all, because it is not a decision. `set_league_competitions` adds it back
 * regardless of what arrives, refuses anything we don't offer, and refuses
 * the whole change while a round is open — turning a competition on
 * mid-gameweek would hand new fixtures to whoever picks next and nothing to
 * the players who have already gone.
 */
export async function setLeagueCompetitions(
  _prev: { error: string | null; success: string | null },
  formData: FormData,
): Promise<{ error: string | null; success: string | null }> {
  const leagueId = String(formData.get('league_id') ?? '');
  if (!leagueId) return { error: 'Missing group.', success: null };

  const extras = formData
    .getAll('competition_id')
    .map((v) => String(v))
    .filter(Boolean);

  const supabase = await createClient();
  const { data, error } = await callRpc<{ competitions: string[] }>(
    supabase,
    'set_league_competitions',
    { p_league_id: leagueId, p_competition_ids: extras },
  );

  if (error) return { error: error.message, success: null };

  revalidatePath(`/leagues/${leagueId}`);
  revalidatePath('/draft');
  revalidatePath('/dashboard');

  const codes = data?.competitions ?? [];
  return {
    error: null,
    success: `Saved — ${codes.length} competition${codes.length === 1 ? '' : 's'}: ${codes.join(', ')}.`,
  };
}
