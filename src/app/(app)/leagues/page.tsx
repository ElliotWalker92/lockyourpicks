import Link from 'next/link';

import { CreateLeagueForm, JoinLeagueForm } from '@/components/LeagueForms';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Leagues' };

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
        <h1 className="display-lg">Leagues</h1>
        <p className="mt-2 text-grey-700">
          A league is your group of players. Inside it, divisions are the pools
          you actually draft against.
        </p>
      </div>

      {leagues.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="label">
            Your leagues
          </h2>
          <ul className="flex flex-col gap-2">
            {leagues.map((league) => (
              <li key={league.id}>
                <Link
                  href={`/leagues/${league.id}`}
                  className="card flex items-center gap-4 px-4 py-3 transition hover:border-ink"
                >
                  <span className="flex-1 font-medium">{league.name}</span>
                  {league.owner_id === user!.id && (
                    <span className="rounded-full bg-lime px-2 py-0.5 text-xs font-medium text-ink">
                      Owner
                    </span>
                  )}
                  <span className="font-mono text-sm tracking-widest text-grey-500">
                    {league.join_code}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-8 sm:grid-cols-2">
        <section className="card p-5">
          <h2 className="label mb-4">
            Start a league
          </h2>
          <CreateLeagueForm />
        </section>

        <section className="card p-5">
          <h2 className="label mb-4">
            Join with a code
          </h2>
          <JoinLeagueForm />
        </section>
      </div>
    </div>
  );
}
