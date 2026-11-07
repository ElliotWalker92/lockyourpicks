import type { MetadataRoute } from 'next';

import { siteOrigin } from '@/lib/company';

/**
 * Every page a stranger can reach without signing in.
 *
 * That is a short list today — the landing page, the two policies and
 * the about page — because the rest of the app is behind a login. It is
 * deliberately a list rather than a crawl: when public fixture and form
 * pages arrive they get added here, and anything that needs a session
 * never should be.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  const now = new Date();

  return [
    { url: `${origin}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${origin}/about`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${origin}/legal/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${origin}/legal/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
