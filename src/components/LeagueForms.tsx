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

export function CreateLeagueForm({
  floor = 0,
  extras = [],
}: {
  floor?: number;
  /** Optional competitions beyond the English core. */
  extras?: { id: string; name: string }[];
}) {
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

      {/* The English game is not offered as a choice, because it isn't one.
          Naming it is still worth doing: somebody setting up a group should
          know what they are getting before they are asked what to add. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Competitions</span>
        <p className="text-xs leading-relaxed text-grey-500">
          The Premier League, the Championship, Leagues One and Two, the FA
          Cup and the EFL Cup are always in &mdash; that&rsquo;s the game, and
          it&rsquo;s what carries {fixturesNeeded(size)} fixtures a week for
          you.
          {extras.length > 0 && ' Add more if you want a bigger card:'}
        </p>
        {extras.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {extras.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    name="competition_id"
                    value={c.id}
                    className="h-4 w-4 shrink-0 accent-lime-dark"
                  />
                  {c.name}
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-grey-500">
          You can change this later, between rounds.
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
