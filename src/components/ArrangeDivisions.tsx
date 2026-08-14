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
      className="btn btn-outline"
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
          className="rounded-md border border-loss/30 bg-loss/5 px-3 py-2 text-sm text-loss"
        >
          {state.error}
        </p>
      )}
      {hasDivisions && (
        <p className="text-xs leading-relaxed text-grey-500">
          Re-arranging rebuilds every division from scratch and reallocates
          players in join order. Once a season is running, promotion and
          relegation should decide this instead.
        </p>
      )}
    </form>
  );
}
