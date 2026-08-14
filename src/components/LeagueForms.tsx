'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  createLeague,
  joinLeague,
  type LeagueState,
} from '@/lib/actions/leagues';

const field =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-lime-300';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-lime-300 dark:text-neutral-900 dark:hover:bg-lime-200"
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
      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
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
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <strong>{size} per division needs {size * 3} fixtures a week.</strong>{' '}
            Three gameweeks this season carry only 10 fixtures across all
            competitions — international breaks. Those drafts would run out of
            fixtures. Three players per division is the largest size that works
            every week.
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-neutral-500">
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
