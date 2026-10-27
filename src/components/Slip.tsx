'use client';

import type { ReactNode } from 'react';

import { FixtureLine } from '@/components/Fixture';
import { verdictOf } from '@/lib/scoring';
import type { Outcome } from '@/lib/types';

/**
 * The slip — one implementation, used everywhere one is drawn.
 *
 * There were three: the draft board's, the whole-group view's, and the
 * results page's. Same nine picks, three sets of markup, and they had
 * already drifted — the group view kept a HOME/DRAW/AWAY chip the board had
 * moved past, results showed the competition code and the others didn't, and
 * the three disagreed about padding, about where the score sat, and about
 * whether a player's head carried a count or a points figure. Fixing a slip
 * meant finding all three and remembering which was which.
 *
 * Nothing here is switched by a mode flag. What varies between the three
 * callers varies because the *data* differs: a head appears when the player
 * is named, points appear when something has been decided, the waiting line
 * appears when picks are still owed, Remove appears when the caller hands
 * over a way to remove. A results page and a live board pass different data
 * and get appropriately different slips out, without either knowing the
 * other exists.
 */

/**
 * Home lime, draw grey, away electric blue — the same key as the outcome
 * buttons and the model's bars.
 *
 * This is what replaced the fixed-width HOME/DRAW/AWAY chip on every row.
 * The chip was saying a third time what the crest and the emboldened club
 * already said twice, and three of them down a card was the single biggest
 * thing making the slip look busy. An edge carries the same information in
 * no horizontal space at all.
 */
const EDGE: Record<Outcome, string> = {
  HOME: 'border-l-lime',
  DRAW: 'border-l-grey-300',
  AWAY: 'border-l-away',
};

/**
 * Shown in place of a scoreline, for the two states that change what a pick
 * is worth.
 *
 * The results page used to label every row — `scheduled` as "picked", `live`
 * as "live" — which put a word on each of nine rows to say what the empty
 * score column and the hot scoreline already said. A postponed or cancelled
 * fixture is different: it scores nothing whatever you called, and that is
 * worth saying out loud rather than leaving as a blank.
 */
const STATUS_NOTE: Record<string, string> = {
  postponed: 'postponed',
  cancelled: 'cancelled',
};

export type SlipPick = {
  /** Stable across renders — a pick id, or the fixture id. */
  key: string;
  home: string;
  away: string;
  homeCrest: string | null;
  awayCrest: string | null;
  outcome: Outcome;
  homeScore: number | null;
  awayScore: number | null;
  result: Outcome | null;
  /** Only `live` changes anything: it turns the score hot. */
  status?: string;
  /** Null until the gameweek settles; 0 or 1 after. */
  points: number | null;
  isAuto?: boolean;
  /** For a list not already grouped by competition — the results page. */
  competition?: string | null;
  /** Given only when this pick can actually be dropped right now. */
  onRemove?: () => void;
  removeDisabled?: boolean;
};

export type SlipPlayer = {
  key: string;
  /**
   * Null draws the picks with no head at all, for a card that already names
   * whose they are — the dashboard's "Your picks".
   */
  name: string | null;
  colour?: string;
  avatarUrl?: string | null;
  /** Lights the card. */
  mine?: boolean;
  /** On the clock. */
  picking?: boolean;
  /**
   * What they've landed. Shown instead of the count once anything has been
   * decided, because by then it's the more interesting number.
   */
  tally?: { landed: number; decided: number; settled: boolean } | null;
  /** The denominator for an `n/m` count, while nothing has been decided. */
  perPlayer?: number;
  picks: SlipPick[];
  /** Under an incomplete set: "2 more to take · by 13:50". */
  waiting?: ReactNode;
};

function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (
    words[0].charAt(0) + words[words.length - 1].charAt(0)
  ).toUpperCase();
}

export function Slip({
  players,
  prominent = false,
}: {
  players: SlipPlayer[];
  /**
   * Sets the points figure bigger. The one thing a finished round wants
   * that a live board doesn't — a week that's over is read for its score.
   */
  prominent?: boolean;
}) {
  return (
    <ol className="flex flex-col gap-2.5">
      {players.map((player) => (
        <li
          key={player.key}
          className={`overflow-hidden rounded-lg border ${
            player.mine ? 'border-lime bg-lime/10' : 'border-grey-300 bg-card'
          }`}
        >
          {player.name !== null && (
            <div className="flex items-center gap-2 px-3 py-2">
              <span
                aria-hidden
                className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full text-[9px] font-semibold text-on-accent"
                style={{ background: player.colour ?? '#c8f135' }}
              >
                {player.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={player.avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initialsOf(player.name)
                )}
              </span>

              <span className="min-w-0 truncate text-sm font-medium">
                {player.name}
              </span>
              {player.mine && (
                <span className="shrink-0 text-xs text-grey-500">you</span>
              )}
              {player.picking && (
                <span className="shrink-0 rounded-full bg-hot px-2 py-0.5 text-[10px] font-semibold text-white">
                  picking
                </span>
              )}

              {player.tally && player.tally.decided > 0 ? (
                <span className="ml-auto flex shrink-0 items-baseline gap-1.5">
                  <span
                    className={`numeric ${prominent ? 'text-2xl' : 'text-base'}`}
                  >
                    {player.tally.landed}
                  </span>
                  <span className="text-xs text-grey-500">
                    {player.tally.settled
                      ? `pt${player.tally.landed === 1 ? '' : 's'}`
                      : `from ${player.tally.decided}`}
                  </span>
                </span>
              ) : (
                player.perPlayer !== undefined && (
                  <span className="ml-auto shrink-0 font-mono text-xs text-grey-500">
                    {player.picks.length}/{player.perPlayer}
                  </span>
                )
              )}
            </div>
          )}

          <ul
            className={player.name !== null ? 'border-t border-grey-100' : ''}
          >
            {player.picks.map((pick) => {
              const verdict = verdictOf({
                predicted_outcome: pick.outcome,
                points_awarded: pick.points,
                result: pick.result,
              });
              const live = pick.status === 'live';
              return (
                <li
                  key={pick.key}
                  // The edge sits on the row rather than inside it, so a
                  // column of calls can be read straight down without
                  // reading any of the fixtures.
                  className={`flex items-center gap-2 border-t border-l-[3px] border-t-grey-100 py-2 pr-3 pl-2.5 text-sm first:border-t-0 ${
                    EDGE[pick.outcome]
                  }`}
                >
                  <FixtureLine
                    home={pick.home}
                    away={pick.away}
                    homeCrest={pick.homeCrest}
                    awayCrest={pick.awayCrest}
                    outcome={pick.outcome}
                    className="min-w-0 flex-1 text-grey-700"
                  />

                  {/* A called draw emboldens both clubs, which on its own
                      is indistinguishable from a row with nothing called.
                      The two sides that do read unambiguously — HOME and
                      AWAY — need no such help. */}
                  {pick.outcome === 'DRAW' && (
                    <span className="shrink-0 text-xs text-grey-500">
                      draw
                    </span>
                  )}

                  {pick.competition && (
                    <span className="hidden shrink-0 rounded bg-grey-100 px-1.5 py-0.5 text-[10px] font-medium text-grey-500 sm:inline">
                      {pick.competition}
                    </span>
                  )}

                  {pick.isAuto && (
                    <span className="shrink-0 rounded bg-grey-100 px-1.5 py-0.5 text-[10px] text-grey-500">
                      auto
                    </span>
                  )}

                  {pick.homeScore !== null ? (
                    <span
                      className={`shrink-0 font-mono text-xs tabular-nums ${
                        live ? 'font-semibold text-hot' : 'text-grey-500'
                      }`}
                    >
                      {pick.homeScore}&ndash;{pick.awayScore}
                    </span>
                  ) : (
                    pick.status &&
                    STATUS_NOTE[pick.status] && (
                      <span className="shrink-0 text-xs text-grey-500">
                        {STATUS_NOTE[pick.status]}
                      </span>
                    )
                  )}

                  {pick.onRemove && !verdict.decided && (
                    <button
                      type="button"
                      onClick={pick.onRemove}
                      disabled={pick.removeDisabled}
                      className="shrink-0 text-xs text-grey-500 underline underline-offset-2 transition hover:text-loss"
                    >
                      Remove
                    </button>
                  )}

                  {/* Fixed width whether or not it's there, so the ticks
                      stay in a column while a weekend resolves. */}
                  {verdict.decided && (
                    <span
                      className={`w-4 shrink-0 text-right font-medium ${
                        verdict.correct ? 'text-win' : 'text-loss'
                      }`}
                      title={verdict.correct ? 'Correct' : 'Wrong'}
                    >
                      {verdict.correct ? '✓' : '✕'}
                    </span>
                  )}
                </li>
              );
            })}

            {player.waiting && (
              <li className="flex flex-wrap items-baseline gap-x-2 border-t border-grey-100 px-3 py-2 text-sm text-grey-400 first:border-t-0">
                {player.waiting}
              </li>
            )}
          </ul>
        </li>
      ))}
    </ol>
  );
}
