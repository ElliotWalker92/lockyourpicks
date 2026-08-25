/**
 * A football pitch, drawn to regulation proportions (105m × 68m) in SVG.
 *
 * Deliberately not a photograph. A stock pitch image would be a few hundred
 * kilobytes, would need art-directing at every breakpoint, and would fight the
 * ink-and-lime palette. Line art costs about a kilobyte, stays crisp at any
 * size, and is drawn in the brand colours by definition.
 *
 * Decorative only — hidden from assistive tech.
 */
export function PitchBackdrop({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1050 680"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <defs>
        {/* Fades the markings out toward the edges so the headline never sits
            on a hard line. */}
        <radialGradient id="pitch-fade" cx="50%" cy="50%" r="62%">
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="55%" stopColor="#fff" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="pitch-mask">
          <rect width="1050" height="680" fill="url(#pitch-fade)" />
        </mask>
      </defs>

      <g
        mask="url(#pitch-mask)"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      >
        {/* Touchlines */}
        <rect x="6" y="6" width="1038" height="668" rx="2" />

        {/* Halfway line, centre circle, centre spot */}
        <line x1="525" y1="6" x2="525" y2="674" />
        <circle cx="525" cy="340" r="91.5" />
        <circle cx="525" cy="340" r="6" fill="currentColor" stroke="none" />

        {/* Left penalty area, goal area, spot, D.
            The D is the part of a 9.15m circle round the penalty spot that
            falls *outside* the box, so it bulges towards halfway. Its ends
            meet the penalty-area line at x = 171, which is 55 from the spot
            — hence ±√(91.5² − 55²) ≈ 73.13 either side of the centre line. */}
        <rect x="6" y="138.5" width="165" height="403" />
        <rect x="6" y="248.5" width="55" height="183" />
        <circle cx="116" cy="340" r="5" fill="currentColor" stroke="none" />
        <path d="M171 266.87A91.5 91.5 0 0 1 171 413.13" />

        {/* Right penalty area, goal area, spot, D — mirrored, so the arc
            sweeps the other way to bulge towards halfway again. */}
        <rect x="879" y="138.5" width="165" height="403" />
        <rect x="989" y="248.5" width="55" height="183" />
        <circle cx="934" cy="340" r="5" fill="currentColor" stroke="none" />
        <path d="M879 266.87A91.5 91.5 0 0 0 879 413.13" />

        {/* Corner arcs */}
        <path d="M6 26a20 20 0 0 0 20-20" />
        <path d="M1044 26a20 20 0 0 1-20-20" />
        <path d="M6 654a20 20 0 0 1 20 20" />
        <path d="M1044 654a20 20 0 0 0-20 20" />
      </g>
    </svg>
  );
}
