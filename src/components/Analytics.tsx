import Script from 'next/script';

/**
 * Cloudflare Web Analytics.
 *
 * Chosen over the alternatives because it is cookieless: it sets nothing
 * on the visitor's device, so it needs no consent banner and the privacy
 * policy's line about having no advertising or tracking cookies stays
 * true. It is also already part of the stack this deploys to.
 *
 * The token is read at request time rather than inlined at build,
 * because `next build` runs without the Worker's environment. No token
 * means no script — a site with no analytics is better than one that
 * loads a beacon pointing at nothing.
 *
 * It is `afterInteractive`, not `beforeInteractive`: nothing on the page
 * depends on it and a measurement beacon has no business competing with
 * the first paint.
 */
export function Analytics({ token }: { token?: string }) {
  if (!token) return null;

  return (
    <Script
      src="https://static.cloudflareinsights.com/beacon.min.js"
      strategy="afterInteractive"
      data-cf-beacon={JSON.stringify({ token })}
    />
  );
}
