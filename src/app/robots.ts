import type { MetadataRoute } from 'next';

import { siteOrigin } from '@/lib/company';

/**
 * What a crawler is allowed to look at.
 *
 * Everything behind the login is disallowed — not for secrecy, since
 * middleware already redirects those routes to sign-in, but because a
 * crawler that spends its budget collecting redirects is not spending it
 * on the pages that should rank. `/api` for the same reason.
 *
 * Nothing here protects anything. It is a hint to well-behaved crawlers,
 * and the RLS policies are what actually keep data in.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/dashboard',
        '/draft',
        '/leaderboard',
        '/leagues',
        '/profile',
        '/results',
        '/standings',
        '/table',
        '/auth/',
      ],
    },
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
