import Link from 'next/link';

import { CreateLeagueForm, JoinLeagueForm } from '@/components/LeagueForms';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Leagues · Lock Your Picks' };

export default async function LeaguesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: memberships } = await supabase
    .from('league_members')
    .select('league_id, leagues(id, name, join_code, owner_id, division_size)')
    .eq('user_id', user!.id);

  const leagues = (memberships ?? [])
    .map((m) => m.leagues)
    .filter((l): l is NonNullable<typeof l> => Boolean(l));

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Leagues</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          A league is your group of players. Inside it, divisions are the pools
          you actually draft against.
        </p>
      </div>

      {leagues.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
            Your leagues
          </h2>
          <ul className="flex flex-col gap-2">
            {leagues.map((league) => (
              <li key={league.id}>
                <Link
                  href={`/leagues/${league.id}`}
                  className="flex items-center gap-4 rounded-xl border border-neutral-200 px-4 py-3 transition hover:border-neutral-900 dark:border-neutral-800 dark:hover:border-neutral-100"
                >
                  <span className="flex-1 font-medium">{league.name}</span>
                  {league.owner_id === user!.id && (
                    <span className="rounded-full bg-lime-300 px-2 py-0.5 text-xs font-medium text-neutral-900">
                      Owner
                    </span>
                  )}
                  <span className="font-mono text-sm tracking-widest text-neutral-500">
                    {league.join_code}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-8 sm:grid-cols-2">
        <section className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">
            Start a league
          </h2>
          <CreateLeagueForm />
        </section>

        <section className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">
            Join with a code
          </h2>
          <JoinLeagueForm />
        </section>
      </div>
    </div>
  );
}
