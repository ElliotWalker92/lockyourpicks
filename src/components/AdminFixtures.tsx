'use client';

import { useState, useTransition } from 'react';

import { setFixtureStatus } from '@/lib/actions/admin';

export type AdminFixture = {
  id: string;
  kickoff_at: string;
  status: string;
  home: string;
  away: string;
  competition: string;
};

/**
 * Calling a fixture off, for when the data provider has not noticed.
 *
 * Deliberately a separate panel rather than a control on each row of the
 * draft board. The board is the thing nine players look at under time
 * pressure; a destructive admin button inside it is a mis-tap waiting to
 * happen, and only one person can use it anyway.
 *
 * Collapsed by default for the same reason.
 */
export function AdminFixtures({ fixtures }: { fixtures: AdminFixture[] }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<{ id: string; text: string; bad: boolean } | null>(
    null,
  );
  const [pending, start] = useTransition();

  const off = fixtures.filter((f) => f.status !== 'scheduled').length;

  function toggle(f: AdminFixture) {
    const next = f.status === 'scheduled' ? 'postponed' : 'scheduled';
    if (
      next === 'postponed' &&
      !confirm(
        `Take ${f.home} v ${f.away} off the board?\n\nAnyone who picked it gets that pick back, can choose again, and will be told.`,
      )
    ) {
      return;
    }
    start(async () => {
      const r = await setFixtureStatus(f.id, next);
      setNote({
        id: f.id,
        text: r.error ?? r.success ?? '',
        bad: Boolean(r.error),
      });
    });
  }

  return (
    <section className="card mt-8 p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span>
          <span className="display-md">Fixture status</span>
          <span className="mt-0.5 block text-sm text-grey-500">
            Admin only. Take a game off the board when it has been called off
            and the data hasn’t caught up.
            {off > 0 && ` ${off} currently off.`}
          </span>
        </span>
        <span className="label shrink-0">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <ul className="mt-5 flex flex-col gap-2">
          {fixtures.map((f) => {
            const scheduled = f.status === 'scheduled';
            return (
              <li
                key={f.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-grey-100 pb-2 last:border-0"
              >
                <span className="w-24 shrink-0 font-mono text-xs text-grey-500">
                  {new Date(f.kickoff_at).toLocaleDateString('en-GB', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
                <span className="min-w-56 flex-1 text-sm">
                  <span className={scheduled ? '' : 'text-grey-500 line-through'}>
                    {f.home} v {f.away}
                  </span>
                  <span className="ml-2 text-xs text-grey-500">
                    {f.competition}
                  </span>
                </span>
                {note?.id === f.id && (
                  <span
                    role="status"
                    className={`text-xs ${note.bad ? 'text-loss' : 'text-grey-500'}`}
                  >
                    {note.text}
                  </span>
                )}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => toggle(f)}
                  className={`btn btn-sm ${scheduled ? 'btn-outline' : 'btn-lime'}`}
                >
                  {scheduled ? 'Call off' : 'Put back'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
