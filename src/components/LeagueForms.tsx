'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { fixturesNeeded, picksForDivisionSize } from '@/lib/division-shape';
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

export function CreateLeagueForm({ floor = 0 }: { floor?: number }) {
  const [state, action] = useActionState(createLeague, { error: null });
  const [size, setSize] = useState(3);

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Group name
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
        {/* A select, not a number box. The number box was controlled, so
            clearing it gave 0 and the next keystroke read "05" — you could
            not simply type 5. There are nine valid values; offer them. */}
        <select
          id="division_size"
          name="division_size"
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className={field}
        >
          {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <option key={n} value={n}>
              {n} player{n === 1 ? '' : 's'}
            </option>
          ))}
        </select>
        <p className="text-xs leading-relaxed text-grey-500">
          Each player takes{' '}
          <strong className="text-ink">
            {picksForDivisionSize(size)} fixture
            {picksForDivisionSize(size) === 1 ? '' : 's'}
          </strong>{' '}
          a week — that follows from the size, because once a match is taken
          nobody else in the division can have it. {size} &times;{' '}
          {picksForDivisionSize(size)} = {fixturesNeeded(size)} a week
          {floor > 0 && <>, and the thinnest gameweek carries {floor}</>}.
        </p>
      </div>

      <Error state={state} />
      <div>
        <Submit label="Create group" />
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
        <Submit label="Join group" />
      </div>
    </form>
  );
}
