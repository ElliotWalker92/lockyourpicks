import Link from 'next/link';
import { redirect } from 'next/navigation';

import { NavLinks } from '@/components/NavLinks';
import { signOut } from '@/lib/actions/auth';
import { createClient } from '@/lib/supabase/server';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards these routes; this is the belt-and-braces check
  // for anything reaching the layout directly.
  if (!user) redirect('/auth/sign-in');

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_color, is_admin')
    .eq('id', user.id)
    .single();

  const name = profile?.display_name ?? user.email?.split('@')[0] ?? 'Player';
  const initial = name.charAt(0).toUpperCase();

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-grey-300 bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-15 w-full max-w-5xl items-center gap-4 px-6 py-3">
          <Link href="/dashboard" className="shrink-0">
            <span className="font-serif text-lg italic">
              Lock Your <span className="text-lime-dark">Picks</span>
            </span>
          </Link>

          <NavLinks isAdmin={profile?.is_admin ?? false} />

          <div className="flex shrink-0 items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-ink"
              style={{ background: profile?.avatar_color ?? '#c8f135' }}
            >
              {initial}
            </span>
            <Link
              href="/profile"
              className="hidden text-sm font-medium transition hover:text-lime-dark sm:inline"
            >
              {name}
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="text-sm text-grey-500 transition hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        {children}
      </main>

      <footer className="border-t border-grey-300">
        <div className="mx-auto w-full max-w-5xl px-6 py-5 text-xs text-grey-500">
          Lock Your Picks
        </div>
      </footer>
    </>
  );
}
