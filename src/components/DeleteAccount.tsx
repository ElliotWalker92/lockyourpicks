'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { deleteAccount } from '@/lib/actions/profile';
import { EMPTY, type ProfileState } from '@/lib/profile-options';

/**
 * Two deliberate obstacles, because this cannot be undone and the
 * button sits at the bottom of a page people scroll through for other
 * reasons.
 *
 * First the form is not there at all until you ask for it. Then it
 * wants the word DELETE typed out — not a checkbox, which the hand
 * ticks before the eye has read anything.
 *
 * In between, it says what will actually happen, including the part
 * nobody expects: a league you own carries on under somebody else.
 * Finding that out afterwards would be a nasty surprise, and it is
 * precisely the sort of thing a vague "this is permanent" warning hides.
 */
function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-hot">
      {pending ? 'Deleting…' : 'Delete my account'}
    </button>
  );
}

export function DeleteAccount({ ownedLeagues }: { ownedLeagues: number }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ProfileState, FormData>(
    deleteAccount,
    EMPTY,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-outline text-loss"
      >
        Delete my account
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="text-sm text-grey-700">
        <p className="mb-2">This cannot be undone. When you confirm:</p>
        <ul className="flex flex-col gap-1.5">
          <li>
            Your name, email, password and picture are deleted, and you are
            signed out everywhere.
          </li>
          <li>
            The picks you have already made stay in your league&rsquo;s history
            so the past seasons still add up — but they stop being attached to
            you, and show as <strong>Deleted player</strong>.
          </li>
          {ownedLeagues > 0 && (
            <li>
              {ownedLeagues === 1 ? 'A league you run' : 'Leagues you run'} will
              pass to whoever joined first, so everyone else can carry on. One
              with nobody else in it is deleted with your account.
            </li>
          )}
          <li>
            You can sign up again later with the same email, but it will be a
            new account with nothing in it.
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-1.5">
        {/* Not id="confirm": the password form higher up the profile page
            already uses that, and a duplicate id silently binds this
            label to that input — a screen reader announced this field as
            "Confirm new password". The form field keeps its own name. */}
        <label htmlFor="confirm-delete" className="label">
          Type DELETE to confirm
        </label>
        <input
          id="confirm-delete"
          name="confirm"
          type="text"
          autoComplete="off"
          required
          className="field"
        />
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-loss/30 bg-loss/5 px-3 py-2 text-sm text-loss"
        >
          {state.error}
        </p>
      )}

      <div className="flex gap-3">
        <Submit />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn btn-outline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
