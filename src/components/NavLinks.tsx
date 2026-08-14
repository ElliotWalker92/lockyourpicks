'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/draft', label: 'Draft' },
  { href: '/table', label: 'Table' },
  { href: '/leagues', label: 'Leagues' },
];

export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
      {LINKS.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition ${
              active
                ? 'bg-lime text-ink'
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
