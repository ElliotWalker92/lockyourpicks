/**
 * The brand mark: a padlock with a tick where the keyhole was.
 *
 * Not `LockIcon`, which is the functional glyph on Lock in buttons and
 * takes `currentColor`. This one is fixed lime, pink and ink, because a
 * logo that changes colour with its surroundings is not a logo. Those
 * three are also why it needs no plate behind it: the tick is dark on
 * the lime body rather than on the page, so it reads the same on a white
 * header and a black one.
 *
 * The same three paths are in `scripts/build-icons.js`, which cuts the
 * favicon, the home-screen icons and the notification badge. Change one
 * and run that, or the thing on the home screen stops being the thing in
 * the header.
 */
export function Mark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Lock Your Picks"
    >
      <path
        d="M22 30 V22 a10 10 0 0 1 20 0 V30"
        fill="none"
        stroke="#ff2d87"
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      <rect x="11" y="28" width="42" height="27" rx="6" fill="#c8f135" />
      <path
        d="M23 41 l6 6 l12 -12"
        fill="none"
        stroke="#0d0d0d"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
