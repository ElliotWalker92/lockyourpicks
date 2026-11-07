import Link from 'next/link';

import { Mark } from '@/components/Mark';
import { COMPANY_LINE, LEGAL_UPDATED } from '@/lib/company';

/**
 * The shell both policies sit in.
 *
 * Its own layout rather than the app's, because these pages are read by
 * people who have not signed in and often have no intention of doing so
 * — there is nothing to navigate, so the chrome is a way back to the
 * front page and nothing else.
 *
 * The narrow column is the point: `max-w-2xl` is about seventy
 * characters at this size, which is where a long paragraph stops being
 * work to read. The rest of the app runs to `max-w-5xl` because it is
 * showing tables.
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
          <Link href="/" className="text-sm text-grey-500 transition hover:text-ink">
            Back to the site
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10 sm:py-14">
        <p className="label">Legal</p>
        {children}
        <p className="mt-10 border-t border-grey-300 pt-5 text-xs text-grey-500">
          Last updated {LEGAL_UPDATED}.
        </p>
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
