import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect('/dashboard');

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div>
        <p className="text-sm font-medium uppercase tracking-widest text-neutral-500">
          Lock Your Picks
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          Three picks. One draft. No second chances.
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
          Every gameweek you draft three fixtures across English football and
          call the result. Once a fixture is taken in your division, it&rsquo;s
          gone &mdash; so pick early, or take what&rsquo;s left.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/auth/sign-up"
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-lime-300 dark:text-neutral-900 dark:hover:bg-lime-200"
        >
          Create account
        </Link>
        <Link
          href="/auth/sign-in"
          className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-medium transition hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
