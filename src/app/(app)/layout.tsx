import Link from 'next/link';
import { redirect } from 'next/navigation';

import { signOut } from '@/lib/actions/auth';
import { createClient } from '@/lib/supabase/server';

const navLinks = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/draft', label: 'Draft' },
  { href: '/table', label: 'Table' },
  { href: '/leagues', label: 'Leagues' },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The proxy already guards these routes; this is the belt-and-braces check
  // for anything that reaches the layout directly.
  if (!user) redirect('/auth/sign-in');

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_color')
    .eq('id', user.id)
    .single();

  const name = profile?.display_name ?? user.email?.split('@')[0] ?? 'Player';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-4xl items-center gap-6 px-6 py-4">
          <Link
            href="/dashboard"
            className="text-sm font-semibold uppercase tracking-widest"
          >
            Lock Your Picks
          </Link>

          <nav className="flex flex-1 items-center gap-5">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-neutral-600 transition hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-neutral-900"
              style={{ background: profile?.avatar_color ?? '#c8f135' }}
            >
              {name.charAt(0).toUpperCase()}
            </span>
            <span className="hidden text-sm text-neutral-600 sm:inline dark:text-neutral-400">
              {name}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="text-sm text-neutral-500 underline underline-offset-4 transition hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        {children}
      </main>
    </div>
  );
}
