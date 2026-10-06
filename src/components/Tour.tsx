'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

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
 * for its target to appear. That wait is the fiddly part: a server
 * component arrives when it arrives, so each step polls for its element and
 * gives up after a moment rather than hanging. Missing targets are normal —
 * there's no lock-in button unless it's your turn.
 *
 * Progress lives in sessionStorage because a tour that's survived three
 * navigations shouldn't be undone by a stray reload, and because the whole
 * thing should be gone by tomorrow either way.
 */

const PROGRESS = 'tour:step';
/** How long to wait for a step's target before giving up on it. */
const WAIT_MS = 1500;

type Rect = { top: number; left: number; width: number; height: number };

/** Hunt for an element, resolving null once it's clearly not coming. */
function waitFor(selector: string, signal: AbortSignal): Promise<Element | null> {
  return new Promise((resolve) => {
    const found = document.querySelector(selector);
    if (found) return resolve(found);

    const deadline = Date.now() + WAIT_MS;
    const tick = () => {
      if (signal.aborted) return resolve(null);
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (Date.now() > deadline) return resolve(null);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function Tour({
  autoStart,
  // The steps are injectable so the engine can be exercised over a set of
  // pages that aren't behind a sign-in. Nothing in the app passes them.
  steps = TOUR,
}: {
  autoStart: boolean;
  steps?: TourStep[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const target = useRef<Element | null>(null);

  const running = index !== null;
  const step: TourStep | null = running ? (steps[index] ?? null) : null;

  // Start, either because this player has never seen it or because a
  // half-finished run is still in the tab.
  //
  // On a frame of its own rather than straight away: the page it is about
  // to point at has only just mounted, and starting inside the effect would
  // put the overlay up during the same commit.
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
      setRect(null);
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
    setRect(null);
    target.current = null;
    setIndex(next);
    try {
      sessionStorage.setItem(PROGRESS, String(next));
    } catch {
      // A tour that can't remember its place still works forwards.
    }
  }, []);

  // Put the current step on screen: navigate if it lives elsewhere, find
  // the target, scroll it into view, measure it.
  useEffect(() => {
    if (!step) return;

    if (step.path !== pathname) {
      router.push(step.path);
      return; // This effect runs again once the path changes.
    }

    const controller = new AbortController();

    if (!step.target) {
      // Centre-screen step; nothing to point at.
      const id = requestAnimationFrame(() => setRect(null));
      return () => cancelAnimationFrame(id);
    }

    waitFor(`[data-tour="${step.target}"]`, controller.signal).then((el) => {
      if (controller.signal.aborted) return;

      if (!el) {
        // Not on this screen for this player. Skip rather than stall.
        setRect(null);
        return;
      }

      target.current = el;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const box = el.getBoundingClientRect();
      setRect({
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
      });
    });

    return () => controller.abort();
  }, [step, pathname, router]);

  // Keep the spotlight on its element if anything moves underneath it.
  useEffect(() => {
    if (!running || !target.current) return;

    const measure = () => {
      const el = target.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      setRect({
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
      });
    };

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
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

  const last = index! === steps.length - 1;
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
      {/* The dark. A click anywhere on it does nothing on purpose: the tour
          is ten taps and the buttons are right there. */}
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
          Step {index! + 1} of {steps.length}
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

          {index! > 0 && (
            <button
              type="button"
              onClick={() => go(index! - 1)}
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
    </div>
  );
}
