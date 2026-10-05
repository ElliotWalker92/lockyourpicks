import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { SupabaseClient } from '@supabase/supabase-js';

import { serverEnv } from '@/lib/server-env';
import type { Database } from '@/lib/types';

/**
 * Sending a web push.
 *
 * The encryption is the awkward part and the reason for the dependency:
 * each message is sealed with the device's own keys before it goes to
 * Apple's or Google's push service, so the service relays something it
 * can't read. Doing that needs ECDH, HKDF and AES-GCM, which `web-push`
 * does with Node's crypto — not available in a Worker. This library does
 * the same with Web Crypto.
 */

export type PushTarget = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushBody = {
  title: string;
  body: string;
  /** Where tapping it should land. */
  url: string;
  /** Replaces an earlier notification with the same tag rather than stacking. */
  tag?: string;
};

type Client = SupabaseClient<Database>;

export function pushConfigured(): boolean {
  return Boolean(
    serverEnv('VAPID_PRIVATE_KEY') && serverEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY'),
  );
}

/**
 * Push to one device.
 *
 * A push service answers 404 or 410 when a subscription is dead — the app
 * was deleted, or the browser dropped it — and it will never work again,
 * so the row goes. Anything else might be temporary and is left alone to
 * be tried next turn.
 */
export async function sendPush(
  supabase: Client,
  target: PushTarget,
  message: PushBody,
): Promise<'sent' | 'gone' | 'failed'> {
  const vapid = {
    subject: serverEnv('VAPID_SUBJECT') ?? 'https://www.lockyourpicks.com',
    publicKey: serverEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY'),
    privateKey: serverEnv('VAPID_PRIVATE_KEY'),
  };

  const payload = await buildPushPayload(
    { data: message, options: { ttl: 60 * 60 * 12, urgency: 'high' } },
    {
      endpoint: target.endpoint,
      expirationTime: null,
      keys: { p256dh: target.p256dh, auth: target.auth },
    },
    vapid,
  );

  const res = await fetch(target.endpoint, {
    method: payload.method,
    headers: payload.headers,
    body: payload.body as BodyInit,
  });

  const table = (supabase as unknown as SupabaseClient).from(
    'push_subscriptions',
  );

  if (res.status === 404 || res.status === 410) {
    await table.delete().eq('id', target.id);
    return 'gone';
  }

  // Anything else — a 5xx from the push service, a timeout — might be
  // temporary. The row is left as it is and tried again next turn rather
  // than being scored against a counter nothing reads.
  if (!res.ok) return 'failed';

  await table
    .update({ last_sent_at: new Date().toISOString() })
    .eq('id', target.id);
  return 'sent';
}
