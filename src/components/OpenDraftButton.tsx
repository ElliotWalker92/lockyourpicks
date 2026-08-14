'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { openDrafts } from '@/lib/actions/draft';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-lime-300 dark:text-neutral-900 dark:hover:bg-lime-200"
    >
      {pending ? 'Opening…' : 'Open draft for this gameweek'}
    </button>
  );
}

export function OpenDraftButton({ gameweekId }: { gameweekId: string }) {
  const [state, action] = useActionState(openDrafts, { error: null });

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="gameweek_id" value={gameweekId} />
      <div>
        <Submit />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}
