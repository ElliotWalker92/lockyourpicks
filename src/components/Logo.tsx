/**
 * The mark, as it appears on a home screen.
 *
 * Same geometry as public/favicon.svg rather than an <img> of it: inline
 * SVG costs no request, scales without a second asset, and keeps the
 * rounded tile crisp at the small sizes the header uses.
 *
 * The colours are fixed rather than themed. This is a logo — it is the same
 * object on a phone's home screen, in a browser tab and up here, and a mark
 * that changes with the page's theme stops being recognisable as one thing.
 * The dark tile is part of it, not a background it happens to sit on.
 */
export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="64" height="64" rx="14" fill="#0d0d0d" />
      <path
        d="M21 36 L21 20 A11 11 0 0 1 43 20 L43 36"
        fill="none"
        stroke="#c8f135"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="11" y="32" width="42" height="26" rx="5" fill="#c8f135" />
      <circle cx="32" cy="42" r="4.5" fill="#0d0d0d" />
      <rect x="30" y="44" width="4" height="7" rx="1" fill="#0d0d0d" />
    </svg>
  );
}
