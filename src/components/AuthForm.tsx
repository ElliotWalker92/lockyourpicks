'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { AuthState } from '@/lib/actions/auth';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-lime-300 dark:text-neutral-900 dark:hover:bg-lime-200"
    >
      {pending ? 'Just a moment…' : label}
    </button>
  );
}

const field =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-lime-300';

export function AuthForm({
  mode,
  action,
}: {
  mode: 'sign-in' | 'sign-up';
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
}) {
  const [state, formAction] = useActionState(action, { error: null });
  const isSignUp = mode === 'sign-up';

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {isSignUp && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="display_name" className="text-sm font-medium">
            Display name
          </label>
          <input
            id="display_name"
            name="display_name"
            type="text"
            autoComplete="nickname"
            placeholder="How you'll show on the leaderboard"
            className={field}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={field}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          className={field}
        />
        {isSignUp && (
          <p className="text-xs text-neutral-500">At least 8 characters.</p>
        )}
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </p>
      )}

      <SubmitButton label={isSignUp ? 'Create account' : 'Sign in'} />

      <p className="text-center text-sm text-neutral-500">
        {isSignUp ? 'Already playing? ' : 'No account yet? '}
        <Link
          href={isSignUp ? '/auth/sign-in' : '/auth/sign-up'}
          className="font-medium text-neutral-900 underline underline-offset-4 dark:text-neutral-100"
        >
          {isSignUp ? 'Sign in' : 'Create one'}
        </Link>
      </p>
    </form>
  );
}
