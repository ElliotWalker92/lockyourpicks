'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { setNewPassword } from '@/lib/actions/auth';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-lime w-full">
      {pending ? 'Saving…' : 'Set new password'}
    </button>
  );
}

/**
 * Reached from the emailed reset link, after /auth/callback has exchanged the
 * code for a session. Without that session the action rejects, which is what
 * happens on an expired or already-used link.
 */
export default function NewPasswordPage() {
  const [state, action] = useActionState(setNewPassword, { error: null });

  return (
    <>
      <h1 className="display-md mb-2">Set a new password</h1>
      <p className="mb-5 text-sm text-grey-700">
        Pick something you&rsquo;ll remember this time.
      </p>

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
            Confirm password
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

        {state.error && (
          <p
            role="alert"
            className="rounded-md border border-loss/30 bg-loss/5 px-3 py-2 text-sm text-loss"
          >
            {state.error}
          </p>
        )}

        <Submit />
      </form>
    </>
  );
}
