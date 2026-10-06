'use client';

import { useActionState } from 'react';

import { setLeagueShape } from '@/lib/actions/leagues';

/**
 * The two numbers that decide whether a group can run.
 *
 * They multiply, and the product has to fit inside the smallest gameweek
 * left — a division of six taking three each needs eighteen fixtures, and
 * the thin weeks on this season's card carry ten. So the headroom is shown
 * rather than left to be discovered by a rejected save, and the arithmetic
 * is spelled out as it changes.
 *
 * Plain selects over anything cleverer: there are nine values of one and
 * five of the other, both are chosen once in a season, and a native select
 * is the control every phone already knows how to open.
 */
export function LeagueShape({
  leagueId,
  divisionSize,
  picksPerPlayer,
  floor,
}: {
  leagueId: string;
  divisionSize: number;
  picksPerPlayer: number;
  floor: number;
}) {
  const [state, action, pending] = useActionState(setLeagueShape, {
    error: null as string | null,
    success: null as string | null,
  });

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="league_id" value={leagueId} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="label text-[10px]">Players per division</span>
          <select
            name="division_size"
            defaultValue={divisionSize}
            className="rounded-md border border-grey-300 bg-card px-2 py-1.5 text-sm"
          >
            {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label text-[10px]">Picks each</span>
          <select
            name="picks_per_player"
            defaultValue={picksPerPlayer}
            className="rounded-md border border-grey-300 bg-card px-2 py-1.5 text-sm"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" disabled={pending} className="btn btn-sm btn-ink">
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>

      <p className="text-sm text-grey-500">
        A division needs one fixture per player per pick, every gameweek
        &mdash; once a match is taken nobody else in that division can have
        it.{' '}
        {floor > 0 ? (
          <>
            The smallest gameweek you have left carries{' '}
            <span className="font-medium text-ink">{floor} fixtures</span>, so{' '}
            {divisionSize} &times; {picksPerPlayer} ={' '}
            <span
              className={
                divisionSize * picksPerPlayer > floor
                  ? 'font-medium text-loss'
                  : 'font-medium text-ink'
              }
            >
              {divisionSize * picksPerPlayer}
            </span>{' '}
            is what you&rsquo;re asking of it.
          </>
        ) : (
          'There are no gameweeks left to check against.'
        )}
      </p>

      <p className="text-sm text-grey-500">
        A round already under way keeps the number it opened with. Changing
        the division size doesn&rsquo;t move anybody &mdash; re-arrange the
        divisions for that.
      </p>

      {state.error && <p className="text-sm text-loss">{state.error}</p>}
      {state.success && <p className="text-sm text-grey-700">{state.success}</p>}
    </form>
  );
}
