'use server';

import { revalidatePath } from 'next/cache';

import { callRpc } from '@/lib/supabase/rpc';
import { deliver } from '@/lib/notify/deliver';
import type { PushTarget } from '@/lib/notify/push';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';

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

type ReleasedPlayer = {
  /**
   * The rows in `pick_releases` this player's news is about. Stamped once
   * they have been told, so the ten-minute pass doesn't tell them again —
   * and so it picks them up if this send fails. See migration 0062.
   */
  release_ids: string[];
  user_id: string;
  display_name: string | null;
  push_targets: PushTarget[] | null;
};

/**
 * Call a fixture off, or put it back on, and tell whoever it hit.
 *
 * The provider is slow on EFL postponements — six League One and Two
 * games in gameweek 23 were called off for international call-ups and
 * still read as "not started" days later, so the board kept offering
 * games that will not be played.
 *
 * The admin check and the status happen in `admin_set_fixture_status`,
 * because a check written here would be a suggestion: a server action is
 * a public endpoint. Releasing the picks is a trigger's job as of 0062,
 * so it holds for the nightly ingest too — the provider found three
 * postponements by itself in gameweek 23 and stranded a pick for a day
 * and a half. What is left for this side is the telling, and it has to be
 * here rather than in the database — the mail key and the VAPID key live
 * in the Worker.
 *
 * The same news also goes out on the ten-minute pass. This path exists
 * because an admin who has just taken a game off the board should see
 * whose round it changed, rather than find out ten minutes later.
 *
 * The notify step runs on a service-role client because it needs
 * addresses, which 0057 took away from `authenticated` after every
 * player's email turned out to be world-readable. By then the RPC has
 * already proved the caller is an admin, so this is not a second way in.
 *
 * A send that fails never fails the call. The fixture is already off the
 * board, which is the part that matters before a deadline; being unable
 * to tell somebody is worth saying, not worth undoing.
 */
export async function setFixtureStatus(
  fixtureId: string,
  status: 'scheduled' | 'postponed' | 'cancelled',
): Promise<AdminState> {
  const supabase = await createClient();

  const { data, error } = await callRpc<{
    fixture: string;
    released: number;
    players: ReleasedPlayer[];
  }>(supabase, 'admin_set_fixture_status', {
    p_fixture_id: fixtureId,
    p_status: status,
  });

  if (error) return { error: error.message, success: null };

  revalidatePath('/draft');

  if (status === 'scheduled') return { error: null, success: 'Back on the board.' };

  const players = data?.players ?? [];
  if (players.length === 0) {
    return { error: null, success: 'Taken off the board. Nobody had picked it.' };
  }

  const told = await tellThem(data!.fixture, players);
  return { error: null, success: told };
}

async function tellThem(
  fixture: string,
  players: ReleasedPlayer[],
): Promise<string> {
  const admin = createServiceRoleClient();

  const { data: rows } = await admin
    .from('profiles')
    .select('id, email')
    .in(
      'id',
      players.map((p) => p.user_id),
    );
  const emails = new Map((rows ?? []).map((r) => [r.id, r.email ?? '']));

  const body =
    `${fixture} has been called off, so your pick on it has been given ` +
    `back. You're a pick short for this round — take another one before ` +
    `the deadline.`;

  const results = await Promise.all(
    players.map(async (p) => {
      const email = emails.get(p.user_id);
      if (!email) return 'skipped';
      const { how } = await deliver(
        admin,
        { email, push_targets: p.push_targets },
        {
          push: {
            title: 'Your pick has been given back',
            body: `${fixture} is off. Pick again before the deadline.`,
            url: '/draft',
          },
          mail: {
            subject: `${fixture} is off \u2014 pick again`,
            text: body,
            html: `<p>${body}</p><p><a href="https://lockyourpicks.com/draft">Open the draft</a></p>`,
          },
        },
      );
      if (how !== 'skipped') {
        // Only once it has actually gone. A failed send left unstamped is
        // picked up by the next ten-minute pass, which is the whole point
        // of the outbox.
        await callRpc(admin, 'mark_pick_releases_notified', {
          p_ids: p.release_ids,
        });
      }
      return how;
    }),
  );

  const reached = results.filter((r) => r !== 'skipped').length;
  const names = players.map((p) => p.display_name ?? 'someone').join(', ');

  if (reached === players.length) {
    return `Taken off the board. ${names} got their pick back and ${
      players.length === 1 ? 'has' : 'have'
    } been told.`;
  }
  return (
    `Taken off the board and ${names} got their pick back, but only ` +
    `${reached} of ${players.length} could be reached \u2014 tell the rest yourself.`
  );
}
