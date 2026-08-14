import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LockIcon } from '@/components/LockIcon';
import { PitchBackdrop } from '@/components/PitchBackdrop';
import { createClient } from '@/lib/supabase/server';

const RULES = [
  {
    n: '01',
    title: 'Draft three fixtures',
    body: 'Every gameweek you take three matches from across the Premier League, Championship, League One, League Two and the cups.',
  },
  {
    n: '02',
    title: 'Take it in turns',
    body: 'Your division drafts in order, and the order rotates each week. Once a fixture is gone, nobody else in your division can have it.',
  },
  {
    n: '03',
    title: 'Call the result',
    body: 'Name the winner, or call the draw. One point per correct result. Miss your turn and the clock picks for you.',
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
      <section className="relative isolate overflow-hidden bg-ink text-white">
        <PitchBackdrop className="absolute inset-0 h-full w-full text-lime/25" />

        {/* Warms the centre so the headline has something to sit against. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(60%_70%_at_30%_45%,rgba(200,241,53,0.14),transparent_70%)]"
        />

        <div className="relative mx-auto w-full max-w-5xl px-6 pt-20 pb-20 sm:pt-28 sm:pb-24">
          <p className="label flex items-center gap-1.5 text-lime">
            <LockIcon className="h-3.5 w-3.5" />
            Lock Your Picks
          </p>

          <h1 className="display-xl mt-5 max-w-3xl text-white">
            Three picks.
            <br />
            One draft.
            <br />
            <span className="italic text-lime">No second chances.</span>
          </h1>

          <p className="mt-7 max-w-xl text-lg leading-relaxed text-white/70">
            A weekly football prediction league where you don&rsquo;t just pick
            winners &mdash; you take the fixtures off everyone else first.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/auth/sign-up" className="btn btn-lime">
              Create your account
            </Link>
            <Link href="/auth/sign-in" className="btn btn-on-dark">
              Sign in
            </Link>
          </div>

          <p className="mt-5 text-sm text-white/50">
            Got a join code from a mate? Create an account, then enter it.
          </p>
        </div>

        {/* ---- Season facts, straddling the fold ---- */}
        <div className="relative border-t border-white/10">
          <dl className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-px px-6 sm:grid-cols-4">
            {[
              ['6', 'competitions'],
              ['92', 'clubs'],
              ['43', 'gameweeks'],
              ['3', 'picks a week'],
            ].map(([value, label]) => (
              <div key={label} className="py-6">
                <dt className="font-serif text-4xl text-lime">{value}</dt>
                <dd className="label mt-1 text-white/50">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ---- How it works ---- */}
      <section className="border-b border-grey-300 bg-card">
        <div className="mx-auto w-full max-w-5xl px-6 py-16">
          <h2 className="label">How it works</h2>

          <div className="mt-9 grid gap-9 sm:grid-cols-3">
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
      <section className="mx-auto w-full max-w-5xl px-6 py-16">
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

          <div className="card overflow-hidden">
            <div className="border-b border-grey-300 px-5 py-3">
              <p className="label">Division 1</p>
            </div>
            <ul>
              {(
                [
                  { pos: '1', label: 'Promoted', note: 'up a tier', tone: 'up' },
                  { pos: '2', label: 'Safe', note: '', tone: 'flat' },
                  {
                    pos: '3',
                    label: 'Relegated',
                    note: 'down a tier',
                    tone: 'down',
                  },
                ] as const
              ).map((row) => (
                <li
                  key={row.pos}
                  className="flex items-center gap-3 border-b border-grey-100 px-5 py-3 text-sm last:border-0"
                >
                  <span className="w-5 font-serif text-lg text-grey-400">
                    {row.pos}
                  </span>
                  <span className="flex-1 font-medium">{row.label}</span>
                  {row.note && (
                    <span
                      className={`text-xs font-medium ${
                        row.tone === 'up' ? 'text-win' : 'text-loss'
                      }`}
                    >
                      {row.tone === 'up' ? '▲' : '▼'} {row.note}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ---- Closing call to action ---- */}
      <section className="border-t border-grey-300 bg-ink text-white">
        <div className="mx-auto w-full max-w-5xl px-6 py-14 text-center">
          <h2 className="display-lg">
            Ready to <span className="italic text-lime">lock them in?</span>
          </h2>
          <div className="mt-7 flex justify-center">
            <Link href="/auth/sign-up" className="btn btn-lime">
              <LockIcon className="h-4 w-4" />
              Create your account
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-grey-300">
        <div className="mx-auto w-full max-w-5xl px-6 py-6 text-sm text-grey-500">
          Lock Your Picks &mdash; a prediction league for people who take it too
          seriously.
        </div>
      </footer>
    </main>
  );
}
