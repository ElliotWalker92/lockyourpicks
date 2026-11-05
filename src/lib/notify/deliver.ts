import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type PushBody,
  type PushTarget,
  pushConfigured,
  sendPush,
} from '@/lib/notify/push';
import { isPlaceholderEmail, sendEmail } from '@/lib/notify/resend';
import type { Database } from '@/lib/types';

/**
 * Getting one message to one person, by whichever channel they have.
 *
 * A phone beats an inbox, so somebody with a device registered gets a
 * push and no email: a turn email went to junk once already, and two
 * nudges for one thing trains people to ignore both. Email remains the
 * channel for everyone who hasn't installed the app, and the fallback
 * whenever every one of a person's devices refuses the push — a dead
 * subscription must not be the reason nobody was told.
 *
 * This lives apart from the jobs that call it because there are now two
 * of them. The rule above is the whole of what "notify somebody" means in
 * this app, and a second copy of it is how the turn nudge and the
 * round-is-in mail would end up disagreeing about what a fallback is.
 */

export type Recipient = {
  email: string;
  /** From the `push_targets` jsonb the pending_* functions return. */
  push_targets: PushTarget[] | null;
};

export type Message = {
  push: PushBody;
  mail: { subject: string; html: string; text: string };
  headers?: Record<string, string>;
};

export type Delivered = {
  /** `skipped` means nobody was told and the send should be retried. */
  how: 'push' | 'email' | 'skipped';
  /**
   * Worth knowing, not a failure. A push that fell back to email still
   * told them, so it must not fail a cron run and wake the admins.
   */
  warning?: string;
};

export async function deliver(
  supabase: SupabaseClient<Database>,
  to: Recipient,
  message: Message,
): Promise<Delivered> {
  const devices = pushConfigured() ? (to.push_targets ?? []) : [];
  let warning: string | undefined;

  if (devices.length > 0) {
    const results = await Promise.all(
      devices.map((device) => sendPush(supabase, device, message.push)),
    );
    if (results.includes('sent')) return { how: 'push' };

    warning =
      `${to.email}: push failed on ${results.length} device` +
      `${results.length === 1 ? '' : 's'} (${results.join(', ')}), fell back to email`;
  }

  // Somebody who hasn't signed up yet and has no real address.
  if (isPlaceholderEmail(to.email)) return { how: 'skipped', warning };

  const sent = await sendEmail({
    to: to.email,
    ...message.mail,
    ...(message.headers ? { headers: message.headers } : {}),
  });

  // No API key configured: `skipped`, so the caller leaves it unstamped
  // and it goes out once notifications are switched on, rather than
  // being lost.
  return { how: sent ? 'email' : 'skipped', warning };
}
