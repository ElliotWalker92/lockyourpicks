'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

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
    .select('id')
    .eq('join_code', code)
    .maybeSingle();

  if (!league) {
    return { error: 'No league with that code. Check it and try again.' };
  }

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

  const { data: members } = await supabase
    .from('league_members')
    .select('user_id, joined_at')
    .eq('league_id', leagueId)
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
