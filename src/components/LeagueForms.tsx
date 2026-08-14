'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createLeague,
  joinLeague,
  joinOpenLeague,
  type LeagueState,
} from '@/lib/actions/leagues';

const field = 'field';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-lime"
    >
      {pending ? 'Working…' : label}
    </button>
  );
}

function Error({ state }: { state: LeagueState }) {
  if (!state.error) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-loss/30 bg-loss/5 px-3 py-2 text-sm text-loss"
    >
      {state.error}
    </p>
  );
}

export function CreateLeagueForm() {
  const [state, action] = useActionState(createLeague, { error: null });
  const [size, setSize] = useState(3);

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          League name
        </label>
        <input
          id="name"
          name="name"
          required
          placeholder="e.g. The Sunday League"
          className={field}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="division_size" className="text-sm font-medium">
          Players per division
        </label>
        <input
          id="division_size"
          name="division_size"
          type="number"
          min={2}
          max={10}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className={field}
        />
        {size > 3 ? (
          <p className="rounded-md border border-loss/30 bg-loss/5 px-3 py-2 text-xs leading-relaxed text-loss">
            <strong>{size} per division needs {size * 3} fixtures a week.</strong>{' '}
            Three gameweeks this season carry only 10 fixtures across all
            competitions — international breaks. Those drafts would run out of
            fixtures. Three players per division is the largest size that works
            every week.
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-grey-500">
            A division of <em>n</em> consumes 3<em>n</em> fixtures a week. Three
            players means 9 — the most that fits every gameweek this season.
          </p>
        )}
      </div>

      <Error state={state} />
      <div>
        <Submit label="Create league" />
      </div>
    </form>
  );
}

/**
 * Take a place in the open league.
 *
 * Deliberately a one-button form with no options. Someone here has no code
 * and no group; asking them to name a league or pick a division size is
 * asking them to make decisions they have no basis for.
 */
export function JoinOpenLeagueForm({ label }: { label?: string }) {
  const [state, action] = useActionState(joinOpenLeague, { error: null });

  return (
    <form action={action} className="flex flex-col gap-3">
      <Error state={state} />
      <div>
        <Submit label={label ?? 'Play the open league'} />
      </div>
    </form>
  );
}

export function JoinLeagueForm() {
  const [state, action] = useActionState(joinLeague, { error: null });

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="join_code" className="text-sm font-medium">
          Join code
        </label>
        <input
          id="join_code"
          name="join_code"
          required
          placeholder="ABC123"
          autoCapitalize="characters"
          className={`${field} font-mono uppercase tracking-widest`}
        />
      </div>

      <Error state={state} />
      <div>
        <Submit label="Join league" />
      </div>
    </form>
  );
}
