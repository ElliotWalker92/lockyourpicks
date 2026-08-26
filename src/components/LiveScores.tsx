'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';

/**
 * Keep a gameweek's scores and points current without a reload.
 *
 * The slip is the thing people leave open on a Saturday afternoon, and a
 * slip that still reads 0–0 an hour after the goal is worse than no slip.
 * The results ingest writes scores into `fixtures` and the points they
 * settle into `gameweek_scores`; this listens for both and re-renders the
 * server component, so the page and the shareable card redraw from one
 * source of truth rather than a second copy of the state kept on the client.
 *
 * Scoped to one gameweek. A postgres_changes filter takes a single equality,
 * which is exactly what a page showing one round needs — the alternative is
 * subscribing to every fixture in six competitions and throwing most of them
 * away.
 *
 * Requires the tables to be in the `supabase_realtime` publication; see
 * migration 0021, which is what made any of this arrive at all.
 */
export function LiveScores({ gameweekId }: { gameweekId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    // Results land in bursts — a whole afternoon's fixtures finish within a
    // few minutes of each other — and each one would otherwise be its own
    // full re-render. One refresh per burst is the same result for a
    // fraction of the work.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, 3000);
    };

    const channel = supabase
      .channel(`scores:${gameweekId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'fixtures',
          filter: `gameweek_id=eq.${gameweekId}`,
        },
        refresh,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'gameweek_scores',
          filter: `gameweek_id=eq.${gameweekId}`,
        },
        refresh,
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [gameweekId, router]);

  return null;
}
