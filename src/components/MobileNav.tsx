'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Bottom tab bar, phones only.
 *
 * The header nav scrolled horizontally on a 375px screen, so Picks and Leagues
 * sat off-edge — the two things people open the app to do. A bottom bar keeps
 * all of them in thumb reach and always visible, which a hamburger doesn't.
 *
 * Icons are inline SVG rather than an icon font: four glyphs isn't worth a
 * webfont request, and the v1 app pulled Tabler from a CDN on every page load.
 */

const ICONS = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  draft: (
    <>
      <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z" />
      <rect x="4" y="6" width="16" height="15" rx="2" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
  table: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  results: (
    <>
      <path d="M4 6h16M4 12h16M4 18h10" />
      <path d="M17.5 17.5 19 19l3-3" />
    </>
  ),
  football: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m12 8.2 3.2 2.3-1.2 3.8h-4l-1.2-3.8L12 8.2Z" />
      <path d="M12 3v5.2M4.2 9.6 9 11M19.8 9.6 15 11M7.2 19l1.6-4.7M16.8 19l-1.6-4.7" />
    </>
  ),
  leagues: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5" />
      <path d="M18 20a5.5 5.5 0 0 0-3-4.9" />
    </>
  ),
};

const TABS: { href: string; label: string; icon: React.ReactNode; also?: string[] }[] = [
  { href: '/dashboard', label: 'Home', icon: ICONS.dashboard },
  { href: '/draft', label: 'Picks', icon: ICONS.draft },
  { href: '/results', label: 'Results', icon: ICONS.results },
  // Table owns the global leaderboard too; they share a toggle.
  { href: '/table', label: 'Table', icon: ICONS.table, also: ['/leaderboard'] },
  { href: '/standings', label: 'Leagues', icon: ICONS.football },
  { href: '/leagues', label: 'Group', icon: ICONS.leagues },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-grey-300 bg-card/95 backdrop-blur sm:hidden"
      // Keeps the bar clear of the iOS home indicator.
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-lg">
        {TABS.map((tab) => {
          const active = [tab.href, ...(tab.also ?? [])].some(
            (p) => pathname === p || pathname.startsWith(`${p}/`),
          );
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${
                  active ? 'text-ink' : 'text-grey-500'
                }`}
              >
                <span
                  className={`flex h-7 w-10 items-center justify-center rounded-full transition ${
                    active ? 'bg-lime text-on-accent' : ''
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-[18px] w-[18px]"
                    aria-hidden
                  >
                    {tab.icon}
                  </svg>
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
