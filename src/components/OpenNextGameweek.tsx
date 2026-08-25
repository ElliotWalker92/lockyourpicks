'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { LockIcon } from '@/components/LockIcon';
import { openNextGameweek, type OpenNextState } from '@/lib/actions/admin';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-lime btn-sm">
      <LockIcon className="h-3.5 w-3.5" />
      {pending ? 'Opening…' : 'Start the next round'}
    </button>
  );
}

/**
 * Opens the next gameweek early.
 *
 * Deliberately not disabled when the round isn't finished: the database is
 * the one that knows, and a button that greys itself out on a stale page
 * would be wrong as often as it was right. Pressing it when it isn't
 * allowed returns the reason, which is more use than a dead control.
 */
export function OpenNextGameweek({ leagueId }: { leagueId: string }) {
  const [state, action] = useActionState<OpenNextState, FormData>(
    openNextGameweek,
    { error: null, message: null },
  );

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="league_id" value={leagueId} />

      <div className="flex flex-wrap items-center gap-3">
        <Submit />
        <p className="text-sm text-grey-500">
          Once everyone&rsquo;s picks are in, don&rsquo;t wait for the
          football.
        </p>
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-loss/30 bg-loss/5 px-3 py-2 text-sm text-loss"
        >
          {state.error}
        </p>
      )}
      {state.message && (
        <p
          role="status"
          className="rounded-md border border-lime-dark/40 bg-lime/10 px-3 py-2 text-sm"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
