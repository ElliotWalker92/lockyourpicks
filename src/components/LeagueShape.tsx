'use client';

import { useActionState, useState } from 'react';

import { setDivisionSize } from '@/lib/actions/leagues';
import { fixturesNeeded, picksForDivisionSize } from '@/lib/division-shape';

/**
 * How many play in a division. The picks follow.
 *
 * Only one control, because only one of the two numbers is a decision: a
 * division needs size × picks distinct fixtures every gameweek and the thin
 * weeks carry ten, so a group of six taking three each simply cannot run.
 * Offering both was offering a choice with a wrong answer in it.
 *
 * The consequence is shown as the selector moves rather than after saving,
 * so the trade is visible while it's being made.
 */
export function LeagueShape({
  leagueId,
  divisionSize,
  floor,
}: {
  leagueId: string;
  divisionSize: number;
  floor: number;
}) {
  const [size, setSize] = useState(divisionSize);
  const [state, action, pending] = useActionState(setDivisionSize, {
    error: null as string | null,
    success: null as string | null,
  });

  const picks = picksForDivisionSize(size);
  const needs = fixturesNeeded(size);
  const tight = floor > 0 && needs > floor;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="league_id" value={leagueId} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="label text-[10px]">Players per division</span>
          <select
            name="division_size"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="rounded-md border border-grey-300 bg-card px-2 py-1.5 text-sm"
          >
            {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <p className="pb-1.5 text-sm">
          <span className="numeric text-lg">{picks}</span>{' '}
          <span className="text-grey-500">
            pick{picks === 1 ? '' : 's'} each
          </span>
        </p>

        <button type="submit" disabled={pending} className="btn btn-sm btn-ink">
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>

      <p className="text-sm text-grey-500">
        The picks follow from the size: a division needs one fixture per
        player per pick every gameweek, because once a match is taken nobody
        else in that division can have it. {size} &times; {picks} ={' '}
        <span className={tight ? 'font-medium text-loss' : 'font-medium text-ink'}>
          {needs} fixtures
        </span>
        {floor > 0 && (
          <>
            , and the smallest gameweek you have left carries {floor}
          </>
        )}
        .
      </p>

      <p className="text-sm text-grey-500">
        A round already under way keeps the number it opened with, and
        changing the size doesn&rsquo;t move anybody &mdash; re-arrange the
        divisions for that.
      </p>

      {state.error && <p className="text-sm text-loss">{state.error}</p>}
      {state.success && <p className="text-sm text-grey-700">{state.success}</p>}
    </form>
  );
}
