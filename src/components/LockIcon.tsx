/**
 * The padlock from the favicon, as a component.
 *
 * Same geometry as public/favicon.svg so the mark reads consistently from the
 * browser tab through to the buttons.
 *
 * `open` draws the shackle lifted — used where a pick is still changeable, so
 * locked and unlocked are visibly different states rather than the same icon
 * with different text next to it.
 */
export function LockIcon({
  open = false,
  className = 'h-4 w-4',
}: {
  open?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {/* Shackle: centred when locked, hinged open to the right when not. */}
      {open ? (
        <path d="M8 10V7a4 4 0 0 1 7.5-1.9" />
      ) : (
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      )}
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
    </svg>
  );
}
