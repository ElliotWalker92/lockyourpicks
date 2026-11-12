import type { SupabaseClient } from '@supabase/supabase-js';

import { deliver } from '@/lib/notify/deliver';
import type { PushTarget } from '@/lib/notify/push';
import type { Database } from '@/lib/types';

/**
 * Telling whoever is a pick short that they can still take one.
 *
 * When an admin calls a fixture off, `admin_set_fixture_status` hands back
 * the players whose picks went and the action tells them there and then
 * (0060). That covers the click, and nothing else: the first five releases
 * were done by hand before that code existed, a player can lose the mail,
 * and a push to a device that has since been wiped counts as delivered.
 * The people it misses are left holding an incomplete slip they have no
 * reason to think they can still fix.
 *
 * So this asks the question from the other end — who is short right now,
 * in a round still open — and tells them. It is the same test the board
 * makes to decide whether to light up, which is the same test `make_pick`
 * makes before it will accept the pick.
 *
 * Run by hand rather than on the ten-minute cron, because there is no
 * marker saying somebody has already been told and a nudge every ten
 * minutes until the deadline would be worse than silence. A marker and a
 * schedule would be better; a message that goes out at all is better than
 * both, and this is wanted before Saturday.
 */

export type ShortReport = {
  due: number;
  sent: number;
  pushed: number;
  skipped: number;
  players: string[];
  errors: string[];
  warnings: string[];
};

type Owed = {
  userId: string;
  name: string;
  email: string;
  short: number;
  gameweek: number;
  closesAt: string;
  targets: PushTarget[];
};

export async function notifyShort(
  supabase: SupabaseClient<Database>,
): Promise<ShortReport> {
  const report: ShortReport = {
    due: 0,
    sent: 0,
    pushed: 0,
    skipped: 0,
    players: [],
    errors: [],
    warnings: [],
  };

  const owed = await whoIsShort(supabase);
  report.due = owed.length;

  for (const player of owed) {
    const fixtures = player.short === 1 ? 'one more' : `${player.short} more`;
    const body =
      `A fixture in your slip was called off, so that pick came back and ` +
      `you're ${player.short} short for gameweek ${player.gameweek}. Your ` +
      `turn has gone, but you can still take ${fixtures} from the board — ` +
      `any time before picking closes ${when(player.closesAt)}.`;

    try {
      const { how, warning } = await deliver(
        supabase,
        { email: player.email, push_targets: player.targets },
        {
          push: {
            title: `You're ${player.short} pick${player.short === 1 ? '' : 's'} short`,
            body: `Take ${fixtures} before picking closes.`,
            url: '/draft',
            tag: `short-${player.gameweek}`,
          },
          mail: {
            subject: `You can still pick — gameweek ${player.gameweek}`,
            text: `${body}\n\nhttps://lockyourpicks.com/draft`,
            html:
              `<p>${body}</p>` +
              `<p><a href="https://lockyourpicks.com/draft">Open the draft</a></p>`,
          },
          headers: {
            'List-Unsubscribe': '<https://www.lockyourpicks.com/profile>',
          },
        },
      );

      if (warning) report.warnings.push(warning);
      if (how === 'skipped') {
        report.skipped++;
      } else {
        report.sent++;
        report.players.push(`${player.name} (${how})`);
        if (how === 'push') report.pushed++;
      }
    } catch (err) {
      report.errors.push(
        `${player.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return report;
}

/**
 * Everyone whose turn has been and gone, in a round still open, who holds
 * fewer picks than their division gives them.
 *
 * Seat before the current turn is what makes this safe to send: somebody
 * who simply hasn't picked yet is not short, they're next, and they get
 * the turn mail instead.
 */
async function whoIsShort(
  supabase: SupabaseClient<Database>,
): Promise<Owed[]> {
  const now = new Date().toISOString();

  const { data: gameweeks, error: gwError } = await supabase
    .from('gameweeks')
    .select('id, number, draft_closes_at')
    .eq('status', 'drafting')
    .gt('draft_closes_at', now);
  if (gwError) throw new Error(`gameweeks: ${gwError.message}`);
  if (!gameweeks?.length) return [];

  const { data: drafts, error: draftError } = await supabase
    .from('drafts')
    .select('id, gameweek_id, pick_order, current_turn, picks_per_player')
    .in(
      'gameweek_id',
      gameweeks.map((g) => g.id),
    );
  if (draftError) throw new Error(`drafts: ${draftError.message}`);
  if (!drafts?.length) return [];

  const { data: picks, error: pickError } = await supabase
    .from('picks')
    .select('draft_id, user_id')
    .in(
      'draft_id',
      drafts.map((d) => d.id),
    );
  if (pickError) throw new Error(`picks: ${pickError.message}`);

  const held = new Map<string, number>();
  for (const pick of picks ?? []) {
    const key = `${pick.draft_id}:${pick.user_id}`;
    held.set(key, (held.get(key) ?? 0) + 1);
  }

  const owed: { draftId: string; userId: string; short: number; gw: (typeof gameweeks)[number] }[] =
    [];
  for (const draft of drafts) {
    const gw = gameweeks.find((g) => g.id === draft.gameweek_id);
    if (!gw) continue;
    (draft.pick_order ?? []).forEach((userId, seat) => {
      if (seat >= draft.current_turn) return;
      const short = draft.picks_per_player - (held.get(`${draft.id}:${userId}`) ?? 0);
      if (short > 0) owed.push({ draftId: draft.id, userId, short, gw });
    });
  }
  if (owed.length === 0) return [];

  const ids = [...new Set(owed.map((o) => o.userId))];
  const [{ data: profiles }, { data: subs }] = await Promise.all([
    supabase.from('profiles').select('id, display_name, email').in('id', ids),
    supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, user_id')
      .in('user_id', ids),
  ]);

  return owed.flatMap((o) => {
    const profile = (profiles ?? []).find((p) => p.id === o.userId);
    if (!profile?.email) return [];
    return [
      {
        userId: o.userId,
        name: profile.display_name ?? 'someone',
        email: profile.email,
        short: o.short,
        gameweek: o.gw.number,
        closesAt: o.gw.draft_closes_at,
        targets: (subs ?? [])
          .filter((s) => s.user_id === o.userId)
          .map(({ id, endpoint, p256dh, auth }) => ({
            id,
            endpoint,
            p256dh,
            auth,
          })),
      },
    ];
  });
}

function when(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  });
}
