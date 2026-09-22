/**
 * Sending mail from the app.
 *
 * Supabase's SMTP settings only cover its own auth emails — confirmations,
 * resets. Anything the app itself wants to say goes through Resend's HTTP
 * API instead, which also avoids needing an SMTP client inside a Worker.
 */
import { serverEnv } from '@/lib/server-env';

export class ResendError extends Error {}

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

const FROM = 'Lock Your Picks <noreply@lockyourpicks.com>';

/**
 * A stand-in address for a player who hasn't signed up yet.
 *
 * `.invalid` is reserved (RFC 2606) and can never be delivered, so it's the
 * one way to give someone an account before they have an email without
 * pointing it at a real mailbox. Mail to it is never attempted: a send that
 * bounces counts against the sending account's reputation, and enough of
 * them gets it paused.
 */
export function isPlaceholderEmail(email: string): boolean {
  return /\.invalid$/i.test(email.trim());
}

/**
 * Returns false when no key is configured rather than throwing, so a
 * deployment without notifications set up degrades to silence instead of
 * failing the cron that calls it.
 */
export async function sendEmail(email: Email): Promise<boolean> {
  const key = serverEnv('RESEND_API_KEY');
  if (!key) return false;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });

  if (!res.ok) {
    throw new ResendError(
      `Resend returned ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return true;
}
