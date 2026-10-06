'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { markTourSeen } from '@/lib/actions/profile';
import { TOUR, type TourStep } from '@/lib/tour';

/**
 * The guided tour: a spotlight on one thing at a time.
 *
 * The hole in the dark is one div sitting on the target with an enormous
 * spread shadow — `box-shadow: 0 0 0 100vmax`. An SVG mask or four framing
 * divs would do the same, but both have to be rebuilt on every resize and
 * every step; a shadow follows the one element it's attached to.
 *
 * The steps span three tabs, so the tour drives the router and then waits
 * for its target to appear. Two rules make that bearable:
 *
 *  - A step whose target isn't there is stepped over, not shown. There is
 *    no lock-in button unless it's your turn and a viewer never sees the
 *    board at all, and a walkthrough that is mostly boxes of text pointing
 *    at nothing is one nobody reads.
 *  - Nothing is drawn until the step has resolved. Deciding a target is
 *    missing means waiting to see whether it is merely late, and drawing
 *    the card during that wait put the text on screen for a second before
 *    yanking it away — the exact flicker the first rule exists to remove.
 *
 * Progress lives in sessionStorage because a tour that's survived three
 * navigations shouldn't be undone by a stray reload, and because the whole
 * thing should be gone by tomorrow either way.
 */

const PROGRESS = 'tour:step';
/** How long a target gets to turn up before the step is written off. */
const WAIT_MS = 1000;

type Rect = { top: number; left: number; width: number; height: number };
/** null while a step is still resolving — see the second rule above. */
type Spot = { kind: 'centred' } | { kind: 'at'; rect: Rect };

const measure = (el: Element): Rect => {
  const box = el.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
};

/**
 * Hunt for an element, resolving null once it's clearly not coming.
 *
 * The wait exists for the moment after a navigation, when the new page is
 * still arriving and its anchors haven't rendered. Once any anchor at all
 * is on the page, that moment has passed — so a target still missing then
 * is genuinely missing, and the step can be stepped over at once instead of
 * sitting on a dark screen for a second per absent step.
 */
function waitFor(
  selector: string,
  signal: AbortSignal,
): Promise<Element | null> {
  return new Promise((resolve) => {
    // Hidden counts as absent. The tab bar is `sm:hidden`, so on a desktop
    // the element is there to be found but has no size — which spotlit a
    // nothing-sized box in the top corner and put a card beside it.
    const look = () => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 ? el : null;
    };
    const found = look();
    if (found) return resolve(found);

    const deadline = Date.now() + WAIT_MS;
    // Twice in a row, so a half-built DOM caught mid-navigation can't be
    // mistaken for a finished page and skip a step that was still coming.
    let settled = 0;
    const tick = () => {
      if (signal.aborted) return resolve(null);
      const el = look();
      if (el) return resolve(el);

      settled = document.querySelector('[data-tour]') ? settled + 1 : 0;
      if (settled >= 2) return resolve(null);

      if (Date.now() > deadline) return resolve(null);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function Tour({
  autoStart,
  // Whether this player has a division of their own. A watcher's dashboard
  // is a different page without the clock, the stats or their own picks on
  // it, and they never see the board — so those steps come out of the plan
  // before it starts rather than being discovered missing one at a time.
  playing,
  // The steps are injectable so the engine can be exercised over a set of
  // pages that aren't behind a sign-in. Nothing in the app passes them.
  steps: given = TOUR,
}: {
  autoStart: boolean;
  playing: boolean;
  steps?: TourStep[];
}) {
  const steps = useMemo(
    () => given.filter((s) => s.requires !== 'playing' || playing),
    [given, playing],
  );
  const router = useRouter();
  const pathname = usePathname();

  const [index, setIndex] = useState<number | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  /**
   * The steps that have actually appeared, in order.
   *
   * What people want from a counter is where they are in the walkthrough
   * they're being given, and steps are stepped over when their target isn't
   * there. Numbering by position in the list told a watcher they were on
   * step 8 of 11 when it was the first thing they had seen.
   */
  const [shown, setShown] = useState<number[]>([]);
  const target = useRef<Element | null>(null);
  /** Which way they're moving, so a skipped step skips the same way. */
  const direction = useRef<1 | -1>(1);

  const running = index !== null;
  const step: TourStep | null = running ? (steps[index] ?? null) : null;

  // Start, either because this player has never seen it or because a
  // half-finished run is still in the tab.
  //
  // On a frame of its own rather than straight away: the page it is about
  // to point at has only just mounted.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      let saved: string | null = null;
      try {
        saved = sessionStorage.getItem(PROGRESS);
      } catch {
        saved = null;
      }

      if (saved !== null) {
        const n = Number(saved);
        if (n >= 0 && n < steps.length) setIndex(n);
        return;
      }
      if (autoStart) setIndex(0);
    });
    return () => cancelAnimationFrame(id);
  }, [autoStart, steps.length]);

  // While the tour runs, nothing else gets to move the page — see
  // ScrollMemory, which stands down when it sees this.
  useEffect(() => {
    if (!running) return;
    document.documentElement.dataset.tour = 'on';
    return () => {
      delete document.documentElement.dataset.tour;
    };
  }, [running]);

  const finish = useCallback(
    (completed: boolean) => {
      setIndex(null);
      setSpot(null);
      setShown([]);
      target.current = null;
      try {
        sessionStorage.removeItem(PROGRESS);
      } catch {
        // Nothing to clean up if it was never stored.
      }
      // Recorded whether they finished or skipped: either way they've been
      // offered it, and offering again would be nagging. Profile has a
      // button for anyone who wants it back.
      void markTourSeen();
      if (completed) router.refresh();
    },
    [router],
  );

  const go = useCallback((next: number) => {
    setSpot(null);
    target.current = null;
    setIndex((prev) => {
      if (prev !== null) direction.current = next >= prev ? 1 : -1;
      return next;
    });
    try {
      sessionStorage.setItem(PROGRESS, String(next));
    } catch {
      // A tour that can't remember its place still works forwards.
    }
  }, []);

  // Put the current step on screen: navigate if it lives elsewhere, find
  // the target, scroll it into view, measure it.
  useEffect(() => {
    if (!step || index === null) return;

    if (step.path !== pathname) {
      router.push(step.path);
      return; // This effect runs again once the path changes.
    }

    const controller = new AbortController();

    if (!step.target) {
      const id = requestAnimationFrame(() => {
        setSpot({ kind: 'centred' });
        setShown((prev) => (prev.includes(index) ? prev : [...prev, index]));
      });
      return () => cancelAnimationFrame(id);
    }

    waitFor(`[data-tour="${step.target}"]`, controller.signal).then((el) => {
      if (controller.signal.aborted) return;

      if (!el) {
        // Not on this screen for this player. Step over it, in whichever
        // direction they were already going, so Back doesn't walk them
        // forwards. Running off either end ends the tour, which also means
        // this can't loop when nothing is left to find.
        const onwards = index + direction.current;
        if (onwards < 0 || onwards >= steps.length) finish(true);
        else go(onwards);
        return;
      }

      target.current = el;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      setSpot({ kind: 'at', rect: measure(el) });
      setShown((prev) => (prev.includes(index) ? prev : [...prev, index]));
    });

    return () => controller.abort();
  }, [step, pathname, router, index, steps.length, finish, go]);

  // Keep the spotlight on its element if anything moves underneath it.
  useEffect(() => {
    if (!running) return;

    const remeasure = () => {
      const el = target.current;
      if (el) setSpot({ kind: 'at', rect: measure(el) });
    };

    window.addEventListener('resize', remeasure);
    window.addEventListener('scroll', remeasure, { passive: true });
    return () => {
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', remeasure);
    };
  }, [running, index]);

  const next = useCallback(() => {
    if (index === null) return;
    if (index + 1 >= steps.length) finish(true);
    else go(index + 1);
  }, [index, finish, go, steps.length]);

  // Escape gets you out, and the arrows step through.
  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false);
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft' && index > 0) go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, finish, go, next]);

  if (!running || !step) return null;

  const rect = spot?.kind === 'at' ? spot.rect : null;
  const last = index === steps.length - 1;
  const padding = 6;

  // Above or below the target, whichever has room. The card is roughly
  // 190px tall; below is preferred because a thumb is already down there.
  const below = rect ? rect.top + rect.height + 210 < window.innerHeight : true;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={step.title}
    >
      {/* The dark. A click on it does nothing on purpose: the tour is a
          handful of taps and the buttons are right there. */}
      {!rect && <div className="absolute inset-0 bg-black/70" />}

      {rect && (
        <div
          className="pointer-events-none absolute rounded-xl transition-all duration-200"
          style={{
            top: rect.top - padding,
            left: rect.left - padding,
            width: rect.width + padding * 2,
            height: rect.height + padding * 2,
            boxShadow: '0 0 0 100vmax rgba(0,0,0,0.7)',
            outline: '2px solid #c8f135',
          }}
        />
      )}

      {/* Nothing but the dark until the step knows what it is pointing at.
          Drawing the card first means showing text that may be about to be
          skipped straight past. */}
      {spot && (
        <div
          className="absolute left-1/2 w-[min(22rem,calc(100vw-2rem))] rounded-xl bg-card p-5 shadow-2xl"
          // Centred with an inline transform rather than -translate-x-1/2.
          // Tailwind 4 writes that class to the `translate` property, which
          // composes with `transform` instead of being replaced by it — the
          // two together shifted the card a whole width off the screen.
          style={
            rect
              ? {
                  top: below
                    ? rect.top + rect.height + padding + 14
                    : Math.max(16, rect.top - padding - 210),
                  transform: 'translateX(-50%)',
                }
              : { top: '50%', transform: 'translate(-50%, -50%)' }
          }
        >
          <p className="label text-[10px]">
            Step {Math.max(1, shown.indexOf(index) + 1)}
          </p>
          <h2 className="display-md mt-1">{step.title}</h2>
          <p className="mt-2 text-sm text-grey-700">{step.body}</p>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={next}
              className="btn btn-lime btn-sm"
              autoFocus
            >
              {last ? 'Got it' : 'Next'}
            </button>

            {/* Only once something has been shown to go back to. On the
                first visible step, Back would walk into the steps that were
                skipped on the way here and fall off the start. */}
            {shown.indexOf(index) > 0 && (
              <button
                type="button"
                onClick={() => go(index - 1)}
                className="btn btn-outline btn-sm"
              >
                Back
              </button>
            )}

            <button
              type="button"
              onClick={() => finish(false)}
              className="ml-auto text-sm text-grey-500 underline underline-offset-4 hover:text-ink"
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
