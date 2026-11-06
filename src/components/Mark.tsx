/**
 * The brand mark: a club crest with a keyhole cut out of it.
 *
 * Not `LockIcon`, which is the functional glyph on Lock in buttons and
 * takes `currentColor`. This one carries its own lime ground, because
 * the crest is ink and the keyhole is the ground showing through — put
 * it on a white header without the tile and the keyhole fills in.
 *
 * The same paths are in `scripts/build-icons.mjs`, which cuts the
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
      <rect width="64" height="64" rx="14" fill="#c8f135" />
      <path
        d="M32 6 L55 13 V31 C55 45 45 55.5 32 60 C19 55.5 9 45 9 31 V13 Z"
        fill="#0d0d0d"
      />
      <circle cx="32" cy="28" r="6.8" fill="#c8f135" />
      <path d="M27.9 33.3 L36.1 33.3 L38 45 L26 45 Z" fill="#c8f135" />
    </svg>
  );
}
