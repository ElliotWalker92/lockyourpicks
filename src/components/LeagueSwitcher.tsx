'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { switchLeague } from '@/lib/actions/league-switch';

/**
 * Which group you're looking at, for anyone in more than one.
 *
 * A select rather than tabs or a menu: it sits in a header that already has
 * five nav links and an avatar on a 375px screen, and the number of groups
 * is whatever somebody happens to have joined. Only rendered when there is
 * a choice to make — one group needs no switch, and a control that never
 * does anything is clutter on every page.
 */
export function LeagueSwitcher({
  leagues,
  activeId,
}: {
  leagues: { id: string; name: string; viewer: boolean }[];
  activeId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (leagues.length < 2) return null;

  return (
    <label className="flex min-w-0 items-center">
      <span className="sr-only">Group</span>
      <select
        value={activeId}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          start(async () => {
            await switchLeague(next);
            // The pages are server-rendered per group, so they have to be
            // asked again rather than re-rendered from what's in the client.
            router.refresh();
          });
        }}
        className="max-w-36 min-w-0 truncate rounded-md border border-grey-300 bg-card px-2 py-1 text-xs font-medium transition hover:border-grey-400 disabled:opacity-60 sm:max-w-none sm:text-sm"
      >
        {leagues.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
            {l.viewer ? ' (watching)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
