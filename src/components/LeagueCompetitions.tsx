'use client';

import { useActionState, useState } from 'react';

import { setLeagueCompetitions } from '@/lib/actions/leagues';
import type { Competition } from '@/lib/competitions';
import { fixturesNeeded } from '@/lib/division-shape';

/**
 * Which competitions the group draws its fixtures from.
 *
 * Deliberately not a grid of tick-boxes over everything the provider sells.
 * The English game is the game — it is listed, so you can see what you have,
 * and it has no control beside it because there is no decision there. The
 * extras are the only thing to choose, and each one is a line saying what it
 * adds rather than a code.
 *
 * The warning about a round being open is shown before the attempt rather
 * than returned after it. `set_league_competitions` refuses it either way,
 * but a disabled button that explains itself is better than a save that
 * fails for a reason you could have been told.
 */
export function LeagueCompetitions({
  leagueId,
  onOffer,
  playing,
  divisionSize,
  roundOpen,
}: {
  leagueId: string;
  onOffer: Competition[];
  /** Competition ids this league plays today, core included. */
  playing: string[];
  divisionSize: number;
  /** A draft is live, so the fixture pool can't move under it. */
  roundOpen: boolean;
}) {
  const core = onOffer.filter((c) => c.is_core);
  const extras = onOffer.filter((c) => !c.is_core);

  const [picked, setPicked] = useState<string[]>(
    playing.filter((id) => extras.some((c) => c.id === id)),
  );
  const [state, action, pending] = useActionState(setLeagueCompetitions, {
    error: null as string | null,
    success: null as string | null,
  });

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const unsaved =
    picked.length !==
      playing.filter((id) => extras.some((c) => c.id === id)).length ||
    picked.some((id) => !playing.includes(id));

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="league_id" value={leagueId} />

      <div>
        <p className="text-sm text-grey-700">
          Always on &mdash; {core.map((c) => c.name).join(', ')}.
        </p>
        <p className="mt-1 text-sm text-grey-500">
          {divisionSize} per division means {fixturesNeeded(divisionSize)}{' '}
          fixtures a gameweek, and the English card is what has to carry that.
          Anything you add below only ever gives you more to choose from.
        </p>
      </div>

      {extras.length === 0 ? (
        <p className="text-sm text-grey-500">
          Nothing else on offer yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 border-t border-grey-300 pt-3">
          {extras.map((c) => (
            <li key={c.id}>
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="competition_id"
                  value={c.id}
                  checked={picked.includes(c.id)}
                  onChange={() => toggle(c.id)}
                  disabled={roundOpen}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-lime-dark"
                />
                <span>
                  <span className="font-medium">{c.name}</span>
                  {playing.includes(c.id) && !picked.includes(c.id) && (
                    <span className="ml-2 text-xs text-loss">
                      will be turned off
                    </span>
                  )}
                  {!playing.includes(c.id) && picked.includes(c.id) && (
                    <span className="ml-2 text-xs text-grey-500">
                      will be turned on
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {roundOpen ? (
        <p className="text-sm text-grey-500">
          Picks are open for this gameweek. You can change this once the round
          has kicked off &mdash; adding fixtures mid-draft would give them to
          whoever picks next and nothing to the players who have already gone.
        </p>
      ) : (
        extras.length > 0 && (
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending || !unsaved}
              className="btn btn-sm btn-ink"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
            {unsaved && (
              <span className="text-sm text-grey-500">
                Takes effect from the next round.
              </span>
            )}
          </div>
        )
      )}

      {state.error && <p className="text-sm text-loss">{state.error}</p>}
      {state.success && <p className="text-sm text-grey-700">{state.success}</p>}
    </form>
  );
}
