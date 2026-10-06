'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Put each tab back where you left it.
 *
 * Next scrolls to the top on every navigation, which is right when you open
 * something new and wrong when you come back. Flicking from halfway down the
 * board to the league table and back put people at the top of the fixture
 * list every time, with their place to find again.
 *
 * Two things make this less obvious than it sounds, and both come from
 * `scroll-behavior: smooth` on the page:
 *
 *  - The jump to the top is an animation lasting the better part of a
 *    second, not an instant move. Restoring with a plain scrollTo starts a
 *    second animation that the first one simply overrides, so the restore
 *    has to be explicitly instant.
 *  - That animation fires scroll events the whole way down. Recording the
 *    position on every scroll therefore overwrites the position you were
 *    actually at with each frame of the animation leaving it, and the page
 *    ends up remembering the top of itself. So nothing is recorded while
 *    scrolling: the position is read once, when a link is clicked, which is
 *    before anything has moved and is the last moment it means something.
 *
 * The navigation links pass `scroll={false}` so Next doesn't animate at all
 * and this is the only thing moving the page.
 *
 * sessionStorage rather than memory, so it survives a reload, and rather
 * than localStorage, so yesterday's position isn't waiting for you
 * tomorrow. Every access is wrapped: a browser with site data blocked
 * throws on the attempt, and a scroll position is never worth an error.
 */

const key = (page: string) => `scroll:${page}`;

const read = (page: string) => {
  try {
    return Number(sessionStorage.getItem(key(page))) || 0;
  } catch {
    return 0;
  }
};

const write = (page: string, y: number) => {
  try {
    sessionStorage.setItem(key(page), String(y));
  } catch {
    // Site data blocked. The page still works; it just won't remember.
  }
};

/**
 * How long to keep trying to apply the position, in frames.
 *
 * The content streams in, so the page is usually still too short to hold
 * the offset on the first frame. Thirty is about half a second — long
 * enough for the server components to land, short enough that it has given
 * up well before anyone could scroll somewhere themselves and be yanked
 * back.
 */
const FRAMES = 30;

export function ScrollMemory() {
  // The path alone, not the query. Stepping to another gameweek on the same
  // page is a same-path navigation, so nothing here fires and Next's own
  // jump to the top stands — which is what you want for different content.
  // It also keeps this out of useSearchParams, which puts the component
  // behind a Suspense boundary that never hydrates on a prerendered page.
  const page = usePathname();

  // Which page the click handler should file a position under. It reads
  // this when a link is clicked, which is long after the effects for the
  // page being left have run.
  const current = useRef(page);
  useEffect(() => {
    current.current = page;
  }, [page]);

  // Remember the position of the page being left, at the moment it's left.
  useEffect(() => {
    // Read straight from the page rather than from a running tally kept by
    // a scroll listener. A click is before anything has navigated, so the
    // position is still the reader's own — and scroll events are both
    // throttled and, with smooth scrolling, still arriving from the last
    // animation, so a tally is behind by however far that got.
    const capture = () => write(current.current, window.scrollY);

    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.('a[href]');
      if (link && link.getAttribute('href')?.startsWith('/')) capture();
    };

    // Capture phase: the position has to be taken before anything the link
    // does can move the page.
    document.addEventListener('click', onClick, true);
    window.addEventListener('pagehide', capture);

    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('pagehide', capture);
    };
  }, []);

  // Apply it on arrival.
  useEffect(() => {
    // The tour moves the page to whatever it's pointing at. Two things
    // scrolling at once is one too many, and the tour is the one the reader
    // is actually watching.
    if (document.documentElement.dataset.tour) return;

    const target = read(page);

    let frames = 0;
    let raf = 0;

    const settle = () => {
      const reachable =
        document.documentElement.scrollHeight - window.innerHeight;

      if (Math.abs(window.scrollY - target) > 1 && reachable >= target) {
        // Instant, not smooth: a half-second animation is both visible as a
        // lurch and liable to be overridden by anything else scrolling.
        window.scrollTo({ top: target, behavior: 'instant' });
        return; // Landed. Nothing more to do.
      }

      if (++frames < FRAMES) raf = requestAnimationFrame(settle);
    };
    raf = requestAnimationFrame(settle);

    return () => cancelAnimationFrame(raf);
  }, [page]);

  return null;
}
