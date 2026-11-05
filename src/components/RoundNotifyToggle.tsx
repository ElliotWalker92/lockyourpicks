'use client';

import { useOptimistic, useTransition } from 'react';

import { setRoundNotifications } from '@/lib/actions/profile';

/**
 * Tell me when the round is in — only shown to people who run a group.
 *
 * Optimistic for the same reason as the turn switch: one that waits on a
 * round trip feels broken.
 */
export function RoundNotifyToggle({
  enabled,
  groups,
}: {
  enabled: boolean;
  /** How many groups they run, so the copy can say which. */
  groups: number;
}) {
  const [optimistic, setOptimistic] = useOptimistic(enabled);
  const [, startTransition] = useTransition();

  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={optimistic}
        onChange={(event) => {
          const next = event.target.checked;
          startTransition(async () => {
            setOptimistic(next);
            await setRoundNotifications(next);
          });
        }}
        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-lime"
      />
      <span>
        <span className="font-medium">When a round is in</span>
        <span className="mt-0.5 block text-sm text-grey-500">
          One message once everybody in{' '}
          {groups === 1 ? 'your group' : 'each group you run'} has picked, so
          you know the card&rsquo;s ready without counting. Your phone if
          it&rsquo;s set up, otherwise email.
        </span>
      </span>
    </label>
  );
}
