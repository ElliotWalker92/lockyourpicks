import type { Metadata } from 'next';
import Link from 'next/link';

import { Mark } from '@/components/Mark';
import { COMPANY, COMPANY_LINE } from '@/lib/company';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Who runs Lock Your Picks, why the draft format exists, and how to get in touch.',
  alternates: { canonical: '/about' },
};

/**
 * Public, and deliberately plain.
 *
 * It exists because an anonymous domain reads as a throwaway. Anyone
 * assessing this site — a player deciding whether to trust it with an
 * email address, or a partner manager deciding whether it is a real
 * business — looks for a named human and a way to reach them, and until
 * now there was neither.
 *
 * Its own layout rather than the app shell: a signed-out visitor has
 * nothing to navigate.
 */
export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-grey-300">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Mark tone="theme" plate={false} className="h-9 w-9" />
            <span className="font-display flex flex-col text-[10px] leading-[1.15] font-bold tracking-[0.18em] uppercase">
              <span>Lock</span>
              <span>Your</span>
              <span className="text-lime-dark">Picks</span>
            </span>
          </Link>
          <Link
            href="/auth/sign-up"
            className="btn btn-lime btn-sm"
          >
            Create your account
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10 sm:py-14">
        <article className="legal">
          <p className="label">About</p>
          <h1 className="display-lg mt-1 mb-4">A prediction league that bites</h1>
          <p className="legal-lede mb-8">
            Most prediction games let everyone pick the same match. This one
            doesn&rsquo;t. Your division drafts fixtures in turn, and once
            somebody takes one, it is gone.
          </p>

          <h2>What it is</h2>
          <p>
            Lock Your Picks is a weekly football prediction league covering the
            Premier League, the Championship, League One, League Two and the
            cups. Each gameweek your division drafts three fixtures each, in
            turn, and calls the results. One point per correct call.
          </p>
          <p>
            Divisions are three players. You are not playing a leaderboard of
            strangers, you are playing the two people either side of you, and
            every fixture one of them takes is one you cannot have. Finish top
            and you go up a tier; finish bottom and you go down.
          </p>

          <h2>Why it works like that</h2>
          <p>
            A prediction game where everyone can pick the same match rewards
            knowing which teams are good. Making the fixtures scarce rewards
            something harder: judging what the other two will take, and when to
            spend your early pick on a banker rather than save it.
          </p>

          <h2>Who runs it</h2>
          <p>
            It is built and run by Elliot Walker, from a spreadsheet that ran a
            league of friends for several seasons before it became a site. It is
            operated by {COMPANY.name}, which also runs{' '}
            <a href="https://deskhops.com">Deskhops</a>.
          </p>
          <p>
            It is free to play. We do not take payment, hold stakes or pay
            prizes &mdash; the <Link href="/legal/terms">terms</Link> set that
            out in full, and the{' '}
            <Link href="/legal/privacy">privacy policy</Link> explains what we
            store and why.
          </p>

          <h2>Getting in touch</h2>
          <p>
            Bugs, questions, a scoring call you think is wrong, or anything
            commercial: <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>.
          </p>
        </article>

        <div className="mt-10 border-t border-grey-300 pt-8">
          <p className="display-md mb-4">Fancy a go?</p>
          <Link href="/auth/sign-up" className="btn btn-lime">
            Create your account
          </Link>
        </div>
      </main>

      <footer className="border-t border-grey-300">
        <div className="mx-auto w-full max-w-2xl px-6 py-6 text-xs text-grey-500">
          <p className="mb-3 flex gap-4">
            <Link href="/legal/terms" className="transition hover:text-ink">
              Terms
            </Link>
            <Link href="/legal/privacy" className="transition hover:text-ink">
              Privacy
            </Link>
          </p>
          {COMPANY_LINE}
        </div>
      </footer>
    </div>
  );
}
