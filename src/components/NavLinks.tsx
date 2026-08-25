'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * `also` marks the other routes a tab owns.
 *
 * Table covers the global leaderboard too — they are the same idea seen at
 * two scales and share a tab, with a toggle between them. Without this the
 * nav would go dark the moment you switched view.
 *
 * "Leagues" now means the real ones: the Premier League and the divisions
 * below it. Your own set of players is a Group, which keeps the two apart
 * in the one place a player has to tell them apart.
 */
const LINKS: { href: string; label: string; also?: string[] }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/draft', label: 'Picks' },
  { href: '/results', label: 'Results' },
  { href: '/table', label: 'Table', also: ['/leaderboard'] },
  { href: '/standings', label: 'Leagues' },
  { href: '/leagues', label: 'Group' },
];

function isActive(pathname: string, href: string, also: string[] = []) {
  return [href, ...also].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
      {LINKS.map((link) => {
        const active = isActive(pathname, link.href, link.also);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition ${
              active
                ? 'bg-lime text-on-accent'
                : 'text-grey-500 hover:bg-grey-100 hover:text-ink'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
      {isAdmin && (
        <span className="ml-1 hidden rounded-full border border-grey-300 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-grey-500 uppercase sm:inline">
          Admin
        </span>
      )}
    </nav>
  );
}
