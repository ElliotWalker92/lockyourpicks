'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { buildDivisions } from '@/lib/actions/leagues';

function Submit({ hasDivisions }: { hasDivisions: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium transition hover:border-neutral-900 disabled:opacity-50 dark:border-neutral-700 dark:hover:border-neutral-100"
    >
      {pending
        ? 'Arranging…'
        : hasDivisions
          ? 'Re-arrange divisions'
          : 'Arrange divisions'}
    </button>
  );
}

export function ArrangeDivisions({
  leagueId,
  hasDivisions,
}: {
  leagueId: string;
  hasDivisions: boolean;
}) {
  const [state, action] = useActionState(buildDivisions, { error: null });

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="league_id" value={leagueId} />
      <div>
        <Submit hasDivisions={hasDivisions} />
      </div>
      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </p>
      )}
      {hasDivisions && (
        <p className="text-xs leading-relaxed text-neutral-500">
          Re-arranging rebuilds every division from scratch and reallocates
          players in join order. Once a season is running, promotion and
          relegation should decide this instead.
        </p>
      )}
    </form>
  );
}
