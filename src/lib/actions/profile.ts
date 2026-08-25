'use server';

import { revalidatePath } from 'next/cache';

import { AVATAR_COLORS, type ProfileState } from '@/lib/profile-options';
import { createClient } from '@/lib/supabase/server';

export async function updateProfile(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const displayName = String(formData.get('display_name') ?? '').trim();
  const avatarColor = String(formData.get('avatar_color') ?? '').trim();

  if (!displayName) {
    return { error: 'Your name can’t be empty.', success: null };
  }
  if (displayName.length > 40) {
    return { error: 'Keep your name under 40 characters.', success: null };
  }
  // Only accept a colour we offered — the field is a radio group, so anything
  // else arrived by tampering rather than by using the form.
  if (avatarColor && !(AVATAR_COLORS as readonly string[]).includes(avatarColor)) {
    return { error: 'That colour isn’t one of the options.', success: null };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You need to be signed in.', success: null };

  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: displayName,
      ...(avatarColor ? { avatar_color: avatarColor } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (error) return { error: error.message, success: null };

  revalidatePath('/', 'layout');
  return { error: null, success: 'Saved.' };
}

export async function updateEmail(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Enter an email address.', success: null };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email });

  if (error) return { error: error.message, success: null };

  // Supabase sends a confirmation to the *new* address; the change only takes
  // effect once that link is clicked, so don't claim it's done.
  return {
    error: null,
    success: `Check ${email} — the change takes effect once you click the confirmation link.`,
  };
}

export async function updatePassword(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.', success: null };
  }
  if (password !== confirm) {
    return { error: 'Those two passwords don’t match.', success: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) return { error: error.message, success: null };
  return { error: null, success: 'Password changed.' };
}

/**
 * Persist the avatar URL after the browser has uploaded the file.
 *
 * The upload itself happens client-side straight to Supabase Storage rather
 * than through here — routing an image through a server action would mean
 * base64-ing it into a request body for no gain.
 */
export async function saveAvatarUrl(url: string | null): Promise<ProfileState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'You need to be signed in.', success: null };

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: url, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  if (error) return { error: error.message, success: null };

  revalidatePath('/', 'layout');
  return {
    error: null,
    success: url ? 'Picture updated.' : 'Picture removed.',
  };
}

/**
 * Turn the "it's your turn" email on or off.
 *
 * The column defaults to true, so a new player is notified without having
 * to find this — an async draft is unplayable if nobody tells you it's
 * your go.
 */
export async function setTurnNotifications(enabled: boolean): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('profiles')
    .update({ notify_turn: enabled })
    .eq('id', user.id);

  revalidatePath('/profile');
}
