import type { Metadata } from 'next';

import { COMPANY, DATA_REGION } from '@/lib/company';

export const metadata: Metadata = {
  title: 'Terms of service',
  description:
    'The terms you agree to by using Lock Your Picks, in plain English.',
};

/**
 * Written against what the app actually does, which at the moment is
 * take no money at all: there is no payment code in this repository and
 * no payment provider in its dependencies. The money section says so
 * plainly, because terms that describe a checkout that does not exist
 * are worse than no terms.
 *
 * If a subscription is ever added, this page needs a payments section
 * and a separate look at whether the game needs a Gambling Commission
 * licence — a prize funded by entry fees is a very different thing from
 * a free game people happen to bet on between themselves.
 */
export default function TermsPage() {
  return (
    <article className="legal">
      <h1 className="display-lg mt-1 mb-4">Terms of service</h1>
      <p className="legal-lede mb-8">
        Lock Your Picks is a free football prediction game played in private
        leagues. We run the site. The game is between you and the people you
        play with.
      </p>

      <h2>The short version</h2>
      <p>
        You draft fixtures against the other people in your division, call the
        results, and climb or fall. It costs nothing. We do not take money, hold
        stakes or pay prizes, and nothing on this site is a bet placed with us.
      </p>

      <h2>Using Lock Your Picks</h2>
      <ul>
        <li>You must be 18 or over to have an account.</li>
        <li>
          Keep your password to yourself. Anyone who has it can sign in as you,
          make your picks and see everything you can see.
        </li>
        <li>
          One account each. A second account to take an extra place in a
          division is the one thing that breaks the game for everyone else in
          it.
        </li>
        <li>
          Pick a display name and a photo you would be happy for the rest of
          your league to see. Nothing offensive, and nothing you do not have the
          right to use.
        </li>
        <li>
          Do not misuse the service: no illegal activity, no harassing other
          players, no trying to break, scrape or overload the site.
        </li>
      </ul>

      <h2>How the game works</h2>
      <ul>
        <li>
          Each gameweek you draft fixtures in turn, within your division. A
          fixture one of you takes is gone for the others — that is the whole
          idea.
        </li>
        <li>
          Picks lock at the deadline shown. The deadline is enforced on our
          server, not in your browser, so a page left open does not buy you
          extra time and a pick that arrives late does not count.
        </li>
        <li>
          If your turn runs out, the clock picks for you. That pick stands.
        </li>
        <li>
          Results come from a third-party football data provider. We score from
          what they report. If they are late or wrong, scores and standings can
          change once it is corrected.
        </li>
        <li>
          We may correct a scoring or data error after the fact, including after
          a gameweek looks settled. We will not change a result simply because
          someone is unhappy with it.
        </li>
        <li>
          Promotion and relegation between divisions follow the rules set out in
          the app at the time. We may change those rules between seasons.
        </li>
      </ul>

      <h2>Money</h2>
      <p>
        We do not take payment, hold money or pay out prizes. There is no
        subscription and no entry fee.
      </p>
      <p>
        If the people in your league play for money among yourselves, that is a
        private arrangement between you. We are not a party to it, we do not see
        it, we do not hold it and we will not settle arguments about it. It is
        on you to be sure that what you are doing is lawful where you live.
      </p>

      <h2>What you can expect from us</h2>
      <p>
        The service is free and provided as it is. We try to keep it up and
        correct, but we do not guarantee that it will always be available, that
        fixture data will always be right or on time, or that nothing will ever
        be lost. We may change how the game works, or stop running it, and we
        will give reasonable notice before stopping it for good.
      </p>

      <h2>Your content</h2>
      <p>
        Your display name, your photo and your picks stay yours. By putting them
        in the app you let us store them and show them to the other people in
        your league, which is what makes the game work. We do not use them for
        anything else.
      </p>

      <h2>Our liability</h2>
      <p>
        We are responsible for the site working broadly as described here. We
        are not liable for the acts of other players, for the accuracy of
        third-party football data, for anything you lose on a private
        arrangement between you and the people you play with, or for anything we
        could not reasonably have foreseen.
      </p>
      <p>
        Because the service is free, our total liability to you is limited to
        £100. Nothing in these terms limits our liability for death or personal
        injury caused by our negligence, for fraud, or for anything else that
        cannot be limited by law. Nothing here affects your rights as a consumer
        under UK law.
      </p>

      <h2>Ending your account</h2>
      <p>
        You can delete your account at any time from your profile page. We may
        suspend or close an account that breaks these terms, and we will tell
        you why unless we are legally prevented from doing so.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        If we change them we will post the new version here with a new date, and
        we will tell you by email if the change is a significant one.
      </p>

      <h2>Who we are, and the law</h2>
      <p>
        Lock Your Picks is operated by {COMPANY.name}, a company registered in{' '}
        {COMPANY.jurisdiction} (number {COMPANY.number}), whose registered
        office is {COMPANY.office}. Your personal data is held in {DATA_REGION};
        our <a href="/legal/privacy">privacy policy</a> sets out what we collect
        and why.
      </p>
      <p>
        These terms are governed by the law of England and Wales, and the courts
        of England and Wales have jurisdiction. For anything at all, email{' '}
        <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>.
      </p>
    </article>
  );
}
