'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  saveAvatarUrl,
  updateEmail,
  updatePassword,
  updateProfile,
} from '@/lib/actions/profile';
import {
  AVATAR_COLORS,
  EMPTY,
  type ProfileState,
} from '@/lib/profile-options';
import { formatBytes, prepareAvatar } from '@/lib/image';
import { createClient } from '@/lib/supabase/client';

/** Anything the browser can decode. Big files are downscaled, not refused. */
const ACCEPT = 'image/*';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-lime">
      {pending ? 'Saving…' : label}
    </button>
  );
}

function Feedback({ state }: { state: ProfileState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="rounded-md border border-loss/30 bg-loss/5 px-3 py-2 text-sm text-loss"
      >
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p
        role="status"
        className="rounded-md border border-win/30 bg-win/5 px-3 py-2 text-sm text-win"
      >
        {state.success}
      </p>
    );
  }
  return null;
}

/* ---------------------------------------------------------------- avatar */

export function AvatarUploader({
  userId,
  avatarUrl,
  avatarColor,
  initials,
}: {
  userId: string;
  avatarUrl: string | null;
  avatarColor: string;
  initials: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ProfileState>(EMPTY);
  const [preview, setPreview] = useState<string | null>(avatarUrl);

  async function onFile(file: File) {
    setBusy(true);
    setState(EMPTY);

    // Downscaled in the browser rather than refused. A phone photo is 3–5 MB
    // and thousands of pixels wide; an avatar renders at 72px.
    let image;
    try {
      image = await prepareAvatar(file);
    } catch (err) {
      setBusy(false);
      setState({
        error: err instanceof Error ? err.message : 'Could not read that file.',
        success: null,
      });
      return;
    }

    const supabase = createClient();
    // Cache-busting filename: overwriting a fixed name leaves the old image
    // cached at the CDN and the change appears not to have worked.
    const path = `${userId}/${Date.now()}.${image.extension}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, image.blob, {
        upsert: true,
        contentType: image.type,
      });

    if (uploadError) {
      setBusy(false);
      setState({ error: uploadError.message, success: null });
      return;
    }

    const shrunk =
      image.originalBytes > image.finalBytes * 1.15
        ? ` Resized from ${formatBytes(image.originalBytes)} to ${formatBytes(image.finalBytes)}.`
        : '';

    const {
      data: { publicUrl },
    } = supabase.storage.from('avatars').getPublicUrl(path);

    const result = await saveAvatarUrl(publicUrl);
    setPreview(publicUrl);
    setState(
      result.error ? result : { error: null, success: `Picture updated.${shrunk}` },
    );
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    const result = await saveAvatarUrl(null);
    setPreview(null);
    setState(result);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        {preview ? (
          <Image
            src={preview}
            alt=""
            width={72}
            height={72}
            unoptimized
            className="h-18 w-18 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="flex h-18 w-18 items-center justify-center rounded-full font-serif text-2xl text-ink"
            style={{ background: avatarColor }}
          >
            {initials}
          </span>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Uploading…' : preview ? 'Change picture' : 'Upload picture'}
          </button>
          {preview && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              disabled={busy}
              onClick={remove}
            >
              Remove
            </button>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
      </div>

      <p className="text-xs text-grey-500">
        Any image. Large photos are resized automatically &mdash; no need to
        shrink anything first.
      </p>

      <Feedback state={state} />
    </div>
  );
}

/* ---------------------------------------------------------------- details */

export function DetailsForm({
  displayName,
  avatarColor,
}: {
  displayName: string;
  avatarColor: string;
}) {
  const [state, action] = useActionState(updateProfile, EMPTY);
  const [colour, setColour] = useState(avatarColor);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="display_name" className="label">
          Display name
        </label>
        <input
          id="display_name"
          name="display_name"
          defaultValue={displayName}
          maxLength={40}
          required
          className="field"
        />
        <p className="text-xs text-grey-500">
          How you appear on the draft board and tables.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-1.5">Avatar colour</legend>
        <div className="flex flex-wrap gap-2">
          {AVATAR_COLORS.map((c) => (
            <label
              key={c}
              className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition ${
                colour === c ? 'ring-2 ring-ink ring-offset-2' : ''
              }`}
              style={{ background: c }}
            >
              <input
                type="radio"
                name="avatar_color"
                value={c}
                checked={colour === c}
                onChange={() => setColour(c)}
                className="sr-only"
              />
              <span className="sr-only">{c}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-grey-500">
          Used when you haven&rsquo;t set a picture.
        </p>
      </fieldset>

      <Feedback state={state} />
      <div>
        <Submit label="Save" />
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- email */

export function EmailForm({ email }: { email: string }) {
  const [state, action] = useActionState(updateEmail, EMPTY);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="label">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          defaultValue={email}
          required
          className="field"
        />
        <p className="text-xs text-grey-500">
          You&rsquo;ll get a confirmation link at the new address. The change
          only happens once you click it.
        </p>
      </div>

      <Feedback state={state} />
      <div>
        <Submit label="Update email" />
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- password */

export function PasswordForm() {
  const [state, action] = useActionState(updatePassword, EMPTY);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="label">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className="field"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm" className="label">
          Confirm new password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          className="field"
        />
        <p className="text-xs text-grey-500">At least 8 characters.</p>
      </div>

      <Feedback state={state} />
      <div>
        <Submit label="Change password" />
      </div>
    </form>
  );
}
