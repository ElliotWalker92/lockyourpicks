'use client';

import { useEffect, useSyncExternalStore } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const COOKIE = 'theme';
const EVENT = 'lockyourpicks:theme';

const OPTIONS: { key: ThemeChoice; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'system', label: 'System' },
];

/**
 * The choice is browser state, not React state, so it's read through
 * useSyncExternalStore rather than copied into an effect. Server and first
 * client render agree on 'system' and React swaps in the real value without
 * a hydration mismatch.
 */
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/** Kept out of the component so the compiler doesn't read it as mutation. */
function writeCookie(value: string) {
  document.cookie = value;
}

function readChoice(): ThemeChoice {
  const match = document.cookie.match(/(?:^|;\s*)theme=(light|dark)/);
  return (match?.[1] as ThemeChoice) ?? 'system';
}

/**
 * Light, dark, or whatever the device is set to.
 *
 * Stored in a cookie rather than localStorage so the server can read it and
 * render the right palette into the HTML — localStorage is only readable
 * once JavaScript runs, which is one frame too late and shows a white flash
 * to somebody reading in the dark.
 *
 * The attribute is set here as well as sent to the server, so the change is
 * instant rather than waiting on a round trip.
 */
export function ThemeToggle() {
  const choice = useSyncExternalStore(
    subscribe,
    readChoice,
    () => 'system' as ThemeChoice,
  );

  // The server stamps data-theme from the cookie on the next request; this
  // keeps the current page in step immediately, so the change is instant
  // rather than waiting on a navigation.
  useEffect(() => {
    const root = document.documentElement;
    if (choice === 'system') delete root.dataset.theme;
    else root.dataset.theme = choice;
  }, [choice]);

  function pick(next: ThemeChoice) {
    const year = 60 * 60 * 24 * 365;
    const cookie =
      next === 'system'
        ? `${COOKIE}=; path=/; max-age=0; samesite=lax`
        : `${COOKIE}=${next}; path=/; max-age=${year}; samesite=lax`;
    writeCookie(cookie);
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-lg border border-grey-300 bg-surface p-0.5"
    >
      {OPTIONS.map((option) => {
        const active = option.key === choice;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => pick(option.key)}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
              active ? 'bg-panel text-white' : 'text-grey-500 hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
