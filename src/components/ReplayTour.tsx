'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { replayTour } from '@/lib/actions/profile';

/**
 * Run the walkthrough again.
 *
 * Clears the stamp and sends them to the dashboard, which is where the
 * tour's first step lives — starting it on the profile page would mean its
 * opening move was to navigate away from the page you pressed the button
 * on.
 */
export function ReplayTour() {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await replayTour();
            router.push('/dashboard');
          })
        }
        className="btn btn-outline btn-sm self-start"
      >
        {pending ? 'Starting…' : 'Start the tour'}
      </button>
    </div>
  );
}
