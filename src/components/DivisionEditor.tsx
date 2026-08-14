'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  saveDivisionSetup,
  type DivisionSetup,
  type SetupState,
} from '@/lib/actions/divisions';

export type EditorPlayer = {
  id: string;
  name: string;
  colour: string;
  avatarUrl: string | null;
};

function initialsOf(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  if (w.length === 1) return w[0].charAt(0).toUpperCase();
  return (w[0].charAt(0) + w[w.length - 1].charAt(0)).toUpperCase();
}

/**
 * Owner-only arrangement editor.
 *
 * Up/down and a division dropdown rather than drag-and-drop: dragging is
 * fiddly on a phone, and this is a once-a-season job for nine people, not
 * something worth a drag library.
 */
export function DivisionEditor({
  leagueId,
  players,
  initial,
}: {
  leagueId: string;
  players: EditorPlayer[];
  initial: DivisionSetup[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<SetupState>({ error: null, success: null });
  const [divisions, setDivisions] = useState<DivisionSetup[]>(initial);
  const [dirty, setDirty] = useState(false);

  const playerOf = (id: string) => players.find((p) => p.id === id);

  function mutate(next: DivisionSetup[]) {
    setDivisions(next);
    setDirty(true);
    setState({ error: null, success: null });
  }

  function rename(divisionId: string, name: string) {
    mutate(divisions.map((d) => (d.id === divisionId ? { ...d, name } : d)));
  }

  /** Move a player up or down within their own division. */
  function reorder(divisionId: string, index: number, direction: -1 | 1) {
    const target = index + direction;
    mutate(
      divisions.map((d) => {
        if (d.id !== divisionId) return d;
        if (target < 0 || target >= d.members.length) return d;
        const members = [...d.members];
        [members[index], members[target]] = [members[target], members[index]];
        return { ...d, members };
      }),
    );
  }

  /** Move a player to another division, appended at the end of its order. */
  function moveTo(userId: string, toDivisionId: string) {
    mutate(
      divisions.map((d) => {
        if (d.id === toDivisionId) {
          return d.members.includes(userId)
            ? d
            : { ...d, members: [...d.members, userId] };
        }
        return { ...d, members: d.members.filter((m) => m !== userId) };
      }),
    );
  }

  function save() {
    startTransition(async () => {
      const result = await saveDivisionSetup(leagueId, divisions);
      setState(result);
      if (!result.error) setDirty(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {divisions.map((division) => (
          <div key={division.id} className="card overflow-hidden">
            <div className="border-b border-grey-300 px-4 py-3">
              <label className="label" htmlFor={`name-${division.id}`}>
                Tier {division.tier} name
              </label>
              <input
                id={`name-${division.id}`}
                value={division.name}
                maxLength={40}
                onChange={(e) => rename(division.id, e.target.value)}
                className="field mt-1.5"
              />
            </div>

            <ul>
              {division.members.length === 0 && (
                <li className="px-4 py-3 text-sm text-grey-500">
                  Nobody here yet.
                </li>
              )}
              {division.members.map((userId, i) => {
                const p = playerOf(userId);
                return (
                  <li
                    key={userId}
                    className="flex items-center gap-2.5 border-b border-grey-100 px-4 py-2.5 text-sm last:border-0"
                  >
                    <span
                      className="w-4 shrink-0 text-xs text-grey-400 tabular-nums"
                      title={`Seat ${i + 1} — starts gameweek ${i + 1}`}
                    >
                      {i + 1}
                    </span>

                    <span
                      aria-hidden
                      className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-semibold text-ink"
                      style={{ background: p?.colour ?? '#c8f135' }}
                    >
                      {p?.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.avatarUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        initialsOf(p?.name ?? '?')
                      )}
                    </span>

                    <span className="min-w-0 flex-1 truncate">
                      {p?.name ?? 'Player'}
                    </span>

                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label="Move up"
                        disabled={i === 0 || pending}
                        onClick={() => reorder(division.id, i, -1)}
                        className="rounded px-1.5 py-0.5 text-grey-500 transition enabled:hover:bg-grey-100 enabled:hover:text-ink disabled:opacity-25"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        disabled={i === division.members.length - 1 || pending}
                        onClick={() => reorder(division.id, i, 1)}
                        className="rounded px-1.5 py-0.5 text-grey-500 transition enabled:hover:bg-grey-100 enabled:hover:text-ink disabled:opacity-25"
                      >
                        ▼
                      </button>

                      <select
                        aria-label={`Move ${p?.name ?? 'player'} to another division`}
                        value={division.id}
                        disabled={pending}
                        onChange={(e) => moveTo(userId, e.target.value)}
                        className="ml-1 rounded-md border border-grey-300 bg-card px-1.5 py-1 text-xs"
                      >
                        {divisions.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name || `Tier ${d.tier}`}
                          </option>
                        ))}
                      </select>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-grey-500">
        The number is the running order. Seat 1 picks first in gameweek 1, seat
        2 in gameweek 2, and so on &mdash; so the first pick rotates through the
        division across the season rather than belonging to one player.
      </p>

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-loss/30 bg-loss/5 px-3 py-2 text-sm text-loss"
        >
          {state.error}
        </p>
      )}
      {state.success && (
        <p
          role="status"
          className="rounded-md border border-win/30 bg-win/5 px-3 py-2 text-sm text-win"
        >
          {state.success}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="btn btn-lime"
        >
          {pending ? 'Saving…' : 'Save arrangement'}
        </button>
        {dirty && !pending && (
          <span className="text-sm text-grey-500">Unsaved changes.</span>
        )}
      </div>
    </div>
  );
}
