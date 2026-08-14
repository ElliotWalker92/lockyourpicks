import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

const RULES = [
  {
    n: '01',
    title: 'Draft three fixtures',
    body: 'Every gameweek you pick three matches from across the Premier League, Championship, League One, League Two and the cups.',
  },
  {
    n: '02',
    title: 'Take it in turns',
    body: 'Your division drafts in order, and the order rotates each week. Once a fixture is taken, nobody else in your division can have it.',
  },
  {
    n: '03',
    title: 'Call the result',
    body: 'Name the winner, or call the draw. One point for every result you get right. Miss your turn and the clock picks for you.',
  },
];

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect('/dashboard');

  return (
    <main className="flex flex-1 flex-col">
      {/* ---- Hero ---- */}
      <section className="mx-auto w-full max-w-5xl px-6 pt-16 pb-14 sm:pt-24">
        <p className="label">Lock Your Picks</p>

        <h1 className="display-xl mt-4 max-w-3xl">
          Three picks.
          <br />
          One draft.
          <br />
          <span className="italic">No second chances.</span>
        </h1>

        <p className="mt-6 max-w-xl text-lg leading-relaxed text-grey-700">
          A weekly football prediction league where you don&rsquo;t just pick
          winners &mdash; you take the fixtures off everyone else first.
        </p>

        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/auth/sign-up" className="btn btn-lime">
            Create your account
          </Link>
          <Link href="/auth/sign-in" className="btn btn-outline">
            Sign in
          </Link>
        </div>

        <p className="mt-4 text-sm text-grey-500">
          Got an invite code from a mate? Create an account, then join their
          league.
        </p>
      </section>

      {/* ---- How it works ---- */}
      <section className="border-t border-grey-300 bg-card">
        <div className="mx-auto w-full max-w-5xl px-6 py-14">
          <h2 className="label">How it works</h2>

          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            {RULES.map((rule) => (
              <div key={rule.n}>
                <span className="font-serif text-3xl text-lime-dark">
                  {rule.n}
                </span>
                <h3 className="display-md mt-2">{rule.title}</h3>
                <p className="mt-2 text-grey-700">{rule.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Divisions ---- */}
      <section className="mx-auto w-full max-w-5xl px-6 py-14">
        <div className="grid items-center gap-10 sm:grid-cols-2">
          <div>
            <h2 className="display-lg">
              Small divisions.
              <br />
              <span className="italic">Real stakes.</span>
            </h2>
            <p className="mt-4 text-grey-700">
              Your league splits into divisions of three. You draft against those
              two, not the whole league &mdash; so every fixture one of them
              takes is one you can&rsquo;t have.
            </p>
            <p className="mt-3 text-grey-700">
              Finish top and you go up. Finish bottom and you go down.
            </p>
          </div>

          <div className="card p-5">
            <p className="label">Division 1</p>
            <ul className="mt-3 divide-y divide-grey-100">
              {(
                [
                  { pos: '1', label: 'Going up', note: 'to the tier above', up: true },
                  { pos: '2', label: 'Safe', note: '', up: false },
                  { pos: '3', label: 'Going down', note: 'to the tier below', up: false },
                ] as const
              ).map((row) => (
                <li
                  key={row.pos}
                  className="flex items-center gap-3 py-2.5 text-sm"
                >
                  <span className="w-5 font-serif text-grey-500">
                    {row.pos}
                  </span>
                  <span className="flex-1 font-medium">{row.label}</span>
                  {row.note && (
                    <span
                      className={`text-xs ${row.up ? 'text-win' : 'text-loss'}`}
                    >
                      {row.note}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <footer className="mt-auto border-t border-grey-300">
        <div className="mx-auto w-full max-w-5xl px-6 py-6 text-sm text-grey-500">
          Lock Your Picks &mdash; a prediction league for people who take it too
          seriously.
        </div>
      </footer>
    </main>
  );
}
