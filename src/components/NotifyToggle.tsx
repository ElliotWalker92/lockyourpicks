'use client';

import { useOptimistic, useTransition } from 'react';

import { setTurnNotifications } from '@/lib/actions/profile';

/**
 * Email me when it's my turn.
 *
 * Optimistic: the switch moves immediately and rolls back if the write
 * fails, because a toggle that waits on a round trip feels broken.
 */
export function NotifyToggle({ enabled }: { enabled: boolean }) {
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
            await setTurnNotifications(next);
          });
        }}
        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-lime"
      />
      <span>
        <span className="font-medium">Email me when it&rsquo;s my turn</span>
        <span className="mt-0.5 block text-sm text-grey-500">
          One email per turn, with how long you&rsquo;ve got. Nothing else.
        </span>
      </span>
    </label>
  );
}
