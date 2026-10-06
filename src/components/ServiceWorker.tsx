'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker, which is what makes the app installable.
 *
 * After load, not during: registration competes with the page's own
 * requests, and nothing here needs it to be early.
 *
 * Not in development. The worker caches everything under /_next/static,
 * which is safe in production because those filenames carry a hash of
 * their contents and change whenever the code does. `next dev` reuses
 * names, so the cache answers with yesterday's JavaScript and the app
 * stops reflecting the file being edited — silently, with the dev server
 * reporting a clean compile. To work on the worker itself, drop this
 * check and remember to unregister it afterwards.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .catch((err) => console.error('service worker:', err));
    };
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register);
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
