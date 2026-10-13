'use client';

import { useActionState, useState } from 'react';

import { undoAutoPicks } from '@/lib/actions/leagues';

/**
 * Hand a turn back to whoever the clock picked for.
 *
 * Only rendered when there is something to undo, and it says who and how
 * many before it will do anything — "undo 6 auto-picks" is a different
 * decision from "undo Teal's and Matt's week", and the owner is usually
 * acting on a message from one of them.
 *
 * Two presses, because it deletes picks. Not a browser confirm(): those are
 * dismissed by reflex, and on a phone they arrive detached from the thing
 * they are asking about.
 */
export function UndoAutoPicks({
  leagueId,
  gameweek,
  picks,
  players,
}: {
  leagueId: string;
  gameweek: number;
  picks: number;
  players: string[];
}) {
  const [armed, setArmed] = useState(false);
  const [state, action, pending] = useActionState(undoAutoPicks, {
    error: null as string | null,
    success: null as string | null,
  });

  if (picks === 0 && !state.success && !state.error) return null;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="league_id" value={leagueId} />

      {picks > 0 && (
        <p className="text-sm text-grey-700">
          The clock made{' '}
          <span className="font-medium text-ink">
            {picks} pick{picks === 1 ? '' : 's'}
          </span>{' '}
          in gameweek {gameweek}
          {players.length > 0 && (
            <> for {players.join(', ')}</>
          )}
          . Undoing gives them their turn back and tells them it&rsquo;s theirs
          again.
        </p>
      )}

      {armed ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending} className="btn btn-sm btn-hot">
            {pending ? 'Undoing…' : `Yes, undo ${picks}`}
          </button>
          <button
            type="button"
            onClick={() => setArmed(false)}
            className="btn btn-sm btn-outline"
          >
            Cancel
          </button>
          <span className="text-sm text-grey-500">
            Picks people made themselves are kept.
          </span>
        </div>
      ) : (
        picks > 0 && (
          <button
            type="button"
            onClick={() => setArmed(true)}
            className="btn btn-sm btn-outline self-start"
          >
            Undo the clock&rsquo;s picks
          </button>
        )
      )}

      {state.error && <p className="text-sm text-loss">{state.error}</p>}
      {state.success && <p className="text-sm text-grey-700">{state.success}</p>}
    </form>
  );
}
