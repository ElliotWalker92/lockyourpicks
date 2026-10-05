import type { MetadataRoute } from 'next';

/**
 * What the home-screen install looks like.
 *
 * `standalone` drops the browser chrome, which is most of what makes it
 * feel like an app; `portrait` because every screen here is a list and
 * nothing gains from landscape.
 *
 * Two 512s on purpose: Android crops an adaptive icon to whatever shape
 * the launcher uses, so the maskable one is drawn smaller inside its
 * square and keeps the padlock clear of the crop. Without it the icon
 * gets its edges shaved off.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Lock Your Picks',
    short_name: 'Lock Your Picks',
    description:
      'Draft three fixtures a round across English football and call the result.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0d0d0d',
    theme_color: '#0d0d0d',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
