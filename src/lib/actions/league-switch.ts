'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { LEAGUE_COOKIE } from '@/lib/active-league';
import { createClient } from '@/lib/supabase/server';

/**
 * Switch which group the app is showing.
 *
 * Membership is checked here as well as when the cookie is read. Reading it
 * safely is what actually protects the data — but writing an id you have no
 * business with would leave you looking at your own group while the cookie
 * says otherwise, which is the kind of mismatch that wastes an afternoon
 * later.
 *
 * The whole layout is revalidated because every page is league-scoped: the
 * dashboard, the board, the results and the table all change together.
 */
export async function switchLeague(leagueId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: membership } = await supabase
    .from('league_members')
    .select('league_id')
    .eq('user_id', user.id)
    .eq('league_id', leagueId)
    .maybeSingle();

  if (!membership) return;

  (await cookies()).set(LEAGUE_COOKIE, leagueId, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });

  revalidatePath('/', 'layout');
}
