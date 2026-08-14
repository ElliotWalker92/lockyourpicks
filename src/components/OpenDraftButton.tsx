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
      className="btn btn-lime"
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
        <p role="alert" className="text-sm text-loss">
          {state.error}
        </p>
      )}
    </form>
  );
}
