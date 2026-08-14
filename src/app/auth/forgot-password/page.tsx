'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { requestPasswordReset } from '@/lib/actions/auth';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-lime w-full">
      {pending ? 'Sending…' : 'Send reset link'}
    </button>
  );
}

export default function ForgotPasswordPage() {
  const [state, action] = useActionState(requestPasswordReset, {
    error: null,
  });

  // Deliberately the same message whether or not the address is registered.
  if ('sent' in state && state.sent) {
    return (
      <div>
        <h1 className="display-md mb-3">Check your email</h1>
        <p className="text-sm leading-relaxed text-grey-700">
          If there&rsquo;s an account with that address, a reset link is on its
          way. It expires after an hour.
        </p>
        <p className="mt-5 text-center text-sm text-grey-500">
          <Link
            href="/auth/sign-in"
            className="font-medium text-ink underline underline-offset-4"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <h1 className="display-md mb-2">Forgot password</h1>
      <p className="mb-5 text-sm text-grey-700">
        Enter your email and we&rsquo;ll send you a link to set a new one.
      </p>

      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="label">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
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

        <Submit />

        <p className="text-center text-sm text-grey-500">
          Remembered it?{' '}
          <Link
            href="/auth/sign-in"
            className="font-medium text-ink underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </form>
    </>
  );
}
