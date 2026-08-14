import Link from 'next/link';

import {
  CreateLeagueForm,
  JoinLeagueForm,
  JoinOpenLeagueForm,
} from '@/components/LeagueForms';
import { LockIcon } from '@/components/LockIcon';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Leagues' };

export default async function LeaguesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: memberships } = await supabase
    .from('league_members')
    .select(
      'league_id, leagues(id, name, join_code, owner_id, division_size, is_open)',
    )
    .eq('user_id', user!.id);

  const leagues = (memberships ?? [])
    .map((m) => m.leagues)
    .filter((l): l is NonNullable<typeof l> => Boolean(l));

  const inALeague = leagues.length > 0;
  const playsOpen = leagues.some((l) => l.is_open);

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
                  {/* The open league's code is deliberately unusable, so
                      showing it would only invite someone to type it. */}
                  {league.is_open ? (
                    <span className="text-sm text-grey-500">Open league</span>
                  ) : (
                    <span className="font-mono text-sm tracking-widest text-grey-500">
                      {league.join_code}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!inALeague && (
        <section className="card border-lime-dark bg-lime/5 p-5">
          <h2 className="label mb-2 flex items-center gap-1.5">
            <LockIcon className="h-3 w-3" />
            No code? Play anyway
          </h2>
          <p className="mb-4 max-w-xl text-sm text-grey-700">
            Take a place in the open league and we&rsquo;ll put you in a
            division of three with other players. You draft against them
            exactly as you would against mates &mdash; same turns, same
            exclusivity &mdash; and you climb the global leaderboard from
            there.
          </p>
          <JoinOpenLeagueForm />
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
          {playsOpen && (
            <p className="mb-3 rounded-md border border-grey-300 bg-surface px-3 py-2 text-xs leading-relaxed text-grey-700">
              You&rsquo;re in the open league. Joining a private one gives up
              that place &mdash; three picks a week means one division. Points
              you&rsquo;ve already scored stay on the global leaderboard.
            </p>
          )}
          <JoinLeagueForm />
        </section>
      </div>
    </div>
  );
}
