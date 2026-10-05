/**
 * Deliberately a small service worker.
 *
 * This app is signed in and live: tables move as results land, and the
 * board changes when a rival takes a fixture. Caching pages would show one
 * player yesterday's table, or — worse, on a shared device — a page
 * rendered for somebody else. So nothing with a session in it is ever
 * stored.
 *
 * What it does: serve the hashed build assets from cache, because their
 * URLs change whenever their contents do, and show an offline card instead
 * of the browser's error page when a navigation fails. That is also enough
 * to make the app installable.
 */
const VERSION = 'v1';
const ASSETS = `assets-${VERSION}`;
const SHELL = `shell-${VERSION}`;
/**
 * Two spellings on purpose. Cloudflare's asset server strips `.html` and
 * redirects, so the page lives at /offline in production; Next's dev
 * server only knows the file it was given. Caching whichever answers
 * keeps the two honest without the worker knowing where it is deployed.
 */
const OFFLINE = ['/offline', '/offline.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => Promise.allSettled(OFFLINE.map((url) => c.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== ASSETS && k !== SHELL)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Build output is content-hashed: same URL means same bytes, for ever.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(ASSETS).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else goes to the network. A failed navigation gets the
  // offline card; a failed anything-else is left to fail, because a
  // half-rendered page is worse than an obvious one.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        for (const url of OFFLINE) {
          const hit = await caches.match(url);
          if (hit) return hit;
        }
        return Response.error();
      }),
    );
  }
});
