'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';

export type AuthState = { error: string | null };

/**
 * Where emailed links come back to.
 *
 * Must match a Redirect URL allowed in the auth project, or Supabase
 * silently substitutes the site URL and drops the query with it.
 */
function siteOrigin(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lockyourpicks.com';
}

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get('email') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
  };
}

export async function signIn(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const { email, password } = readCredentials(formData);

  if (!email || !password) {
    return { error: 'Enter your email and password.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const { email, password } = readCredentials(formData);
  const displayName = String(formData.get('display_name') ?? '').trim();

  if (!email || !password) {
    return { error: 'Enter your email and password.' };
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName || email.split('@')[0] },
      // Without this the link lands on the site root — the marketing page,
      // asking someone who has just confirmed their email to sign in again.
      // Sending it through the callback exchanges the code for a session, so
      // confirming drops them straight onto the dashboard.
      emailRedirectTo: `${siteOrigin()}/auth/callback?next=/dashboard`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  // With email confirmation on, signUp returns a user but no session — the
  // account isn't usable until they click the link.
  if (data.user && !data.session) {
    redirect('/auth/check-email');
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/');
}

/**
 * Send a password-reset link.
 *
 * An address with no account gets the same "check your inbox" as one with
 * an account — saying "no account found" would turn the form into a way to
 * test who is in the league. Supabase already does that for us: it answers
 * success for an unknown address.
 *
 * So an error from here is never "no such account". It's a real failure —
 * the mail server refusing, or the send rate limit — and it has to be said.
 * This used to swallow it and report success regardless, which is how
 * resets failed for everyone while each of them was told it had worked.
 */
export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState & { sent?: boolean }> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Enter your email address.' };

  const supabase = await createClient();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteOrigin()}/auth/callback?next=/auth/new-password`,
  });

  if (error) {
    console.error('resetPasswordForEmail:', error.status, error.message);
    return {
      error:
        error.status === 429
          ? 'Too many reset emails have gone out in the last hour. Try again in a little while.'
          : 'We couldn’t send the reset email just now. Try again shortly — if it keeps happening, let the league admin know.',
    };
  }

  return { error: null, sent: true };
}

/** Set a new password once the reset link has established a session. */
export async function setNewPassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }
  if (password !== confirm) {
    return { error: 'Those two passwords don’t match.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Landing here without a session means the link was stale or already used.
  if (!user) {
    return {
      error: 'That reset link has expired. Request a new one and try again.',
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
