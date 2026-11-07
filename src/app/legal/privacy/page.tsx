import type { Metadata } from 'next';

import { COMPANY, DATA_REGION } from '@/lib/company';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'What Lock Your Picks collects, why, who else sees it and how to get it back.',
};

/**
 * Every claim here is checked against the code rather than copied from
 * the sister site, because the two apps collect different things:
 * Deskhops signs people in with a magic link and takes card payments,
 * this one has passwords and takes no money.
 *
 * Three details worth keeping honest if any of them changes:
 *  - the avatars bucket is public, so a photo is readable by anyone
 *    holding its URL (migration 0008);
 *  - there is no analytics or advertising code in the app at all, which
 *    is why there is no cookie banner;
 *  - API-Football is the only outbound call that is not a supplier
 *    processing our data, and nothing personal is sent to it.
 */
export default function PrivacyPage() {
  return (
    <article className="legal">
      <h1 className="display-lg mt-1 mb-4">Privacy policy</h1>
      <p className="legal-lede mb-8">
        What we collect, why we are allowed to, who else sees it, and how to get
        it back. We do not sell it, and there is no advertising or tracking code
        anywhere in this app.
      </p>

      <h2>Who we are</h2>
      <p>
        Lock Your Picks is operated by {COMPANY.name}, a company registered in{' '}
        {COMPANY.jurisdiction} (number {COMPANY.number}), whose registered
        office is {COMPANY.office}. We are the data controller for everything
        described here, and our ICO registration number is {COMPANY.ico}.
      </p>
      <p>
        For anything in this policy, email{' '}
        <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>When you sign up:</strong> your email address and a password.
          The password is hashed by our authentication provider before it is
          stored. We never see it, and nobody here can look it up or recover it
          for you.
        </li>
        <li>
          <strong>Your profile:</strong> a display name, an avatar colour, and a
          photo if you upload one.
        </li>
        <li>
          <strong>When you play:</strong> the fixtures you draft, the results
          you call, when you picked them, your scores, and the leagues and
          divisions you belong to.
        </li>
        <li>
          <strong>If you turn on notifications:</strong> the subscription your
          browser hands us — an address for that device and two keys used to
          encrypt the message to it — plus the name you give the device so you
          can tell your phone from your laptop, and which kinds of notification
          you want.
        </li>
        <li>
          <strong>Automatically:</strong> ordinary server logs kept by our
          hosting provider, which include IP addresses, for keeping the site up
          and stopping abuse.
        </li>
      </ul>

      <h2>Why we are allowed to use it</h2>
      <ul>
        <li>
          <strong>To run the game</strong> — your account, your picks, the
          standings, the emails that tell you a round is open or closed. This is
          necessary to perform our contract with you.
        </li>
        <li>
          <strong>To keep the service working and safe</strong> — logs,
          diagnosing faults, stopping abuse. This is our legitimate interest in
          running a service that stays up and is not abused.
        </li>
        <li>
          <strong>Push notifications</strong> — only once you turn them on, and
          you can turn them off again from your profile page at any time.
        </li>
      </ul>
      <p>
        We do not send marketing email. The only email we send is about your own
        account and your own rounds.
      </p>

      <h2>Who else sees it</h2>
      <ul>
        <li>
          <strong>The people you play with</strong> see your display name, your
          avatar, the fixtures you have taken, your picks once the deadline has
          passed, and your scores. That is the game — if you would rather your
          picks were private, this is not the app for you.
        </li>
        <li>
          <strong>Anyone with the link</strong> can open your profile photo. It
          is served from a public address and is not listed anywhere, but it is
          not behind the login. Your email address is never shown to other
          players.
        </li>
        <li>
          <strong>Our suppliers</strong>, who process data on our behalf under
          contract: Cloudflare (hosting), Supabase (database, sign-in and photo
          storage) and Resend (email delivery).
        </li>
        <li>
          <strong>Our football data provider</strong> tells us about fixtures
          and results. The traffic only goes one way — we ask about matches and
          never send them anything about you.
        </li>
      </ul>
      <p>We never sell your personal data.</p>

      <h2>Where it is kept</h2>
      <p>
        Our database and photo storage are hosted in {DATA_REGION}. Some
        suppliers may process data outside the UK; where they do, we rely on the
        UK&rsquo;s approved transfer safeguards.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          <strong>Your account and profile</strong> — until you delete it.
        </li>
        <li>
          <strong>Your picks and scores</strong> — for as long as the league you
          played in keeps its history, so past seasons still add up. Once your
          account is gone they are no longer attached to you.
        </li>
        <li>
          <strong>Notification subscriptions</strong> — until you turn
          notifications off, remove the device, or the browser retires the
          subscription, whichever comes first.
        </li>
        <li>
          <strong>Server logs</strong> — for the short period our hosting
          provider retains them.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Under UK data protection law you can ask us to: give you a copy of your
        data; correct it; delete it; restrict or object to how we use it; or
        send it to another service.
      </p>
      <p>
        To do any of these, email{' '}
        <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>. We will respond
        within one month. If you think we have got something wrong you can
        complain to the Information Commissioner&rsquo;s Office at{' '}
        <a href="https://ico.org.uk">ico.org.uk</a> — though we would be
        grateful for the chance to put it right first.
      </p>

      <h2>Cookies</h2>
      <p>
        We only use the cookies the site needs to work: they keep you signed in
        and keep forms secure. There are no advertising or analytics cookies,
        and no third-party tracking code in the app — which is why you have
        never been asked to accept anything.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If we change it we will post the new version here with a new date, and
        tell you by email if the change is a significant one.
      </p>
    </article>
  );
}
