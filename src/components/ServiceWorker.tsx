'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker, which is what makes the app installable.
 *
 * After load, not during: registration competes with the page's own
 * requests, and nothing here needs it to be early.
 */
export function ServiceWorker() {
  useEffect(() => {
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
