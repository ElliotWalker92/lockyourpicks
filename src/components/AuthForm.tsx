'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { AuthState } from '@/lib/actions/auth';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-lime w-full">
      {pending ? 'Just a moment…' : label}
    </button>
  );
}

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
          <label htmlFor="display_name" className="label">
            Display name
          </label>
          <input
            id="display_name"
            name="display_name"
            type="text"
            autoComplete="nickname"
            placeholder="How you'll show on the table"
            className="field"
          />
        </div>
      )}

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

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          className="field"
        />
        {isSignUp && (
          <p className="text-xs text-grey-500">At least 8 characters.</p>
        )}
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-loss/30 bg-loss/5 px-3 py-2 text-sm text-loss"
        >
          {state.error}
        </p>
      )}

      <SubmitButton label={isSignUp ? 'Create account' : 'Sign in'} />

      <p className="text-center text-sm text-grey-500">
        {isSignUp ? 'Already playing? ' : 'No account yet? '}
        <Link
          href={isSignUp ? '/auth/sign-in' : '/auth/sign-up'}
          className="font-medium text-ink underline underline-offset-4"
        >
          {isSignUp ? 'Sign in' : 'Create one'}
        </Link>
      </p>
    </form>
  );
}
