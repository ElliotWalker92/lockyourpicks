/**
 * The brand mark: a club badge with three shirt stripes and a keyhole.
 *
 * Not `LockIcon`, which is the functional glyph on Lock in buttons and
 * takes `currentColor`. This one carries its own tile, because the
 * keyline, the stripes and the keyhole are all the ground showing
 * through the badge — drop the tile and they fill in solid.
 *
 * One badge, five colourways. The shapes never change, so they read as
 * the same mark however they are painted: `lime` is the app icon, the
 * one on a home screen; `ink` is what the header wears, where a dark
 * tile has more presence against the page than another lime square
 * would; the rest are there to be used, not decoration for its own sake
 * — a division, a league, a season can each wear one.
 *
 * The `lime` shapes are also in `scripts/build-icons.mjs`, which cuts
 * the favicon, the home-screen icons and the notification badge. Change
 * one and run that, or the thing on the home screen stops being the
 * thing in the header.
 */
const INK = '#0d0d0d';
const LIME = '#c8f135';
const HOT = '#ff2d87';
const HOT_DARK = '#e51e73';
const BLUE = '#3b82f6';
const BLUE_DARK = '#2563eb';

const CREST = 'M10 11 H54 V31 C54 44 45 53.5 32 59 C19 53.5 10 44 10 31 Z';
const KEYLINE = 0.9;
const FIELD = 0.81;

/**
 * A stripe is either the ground bled back through the badge, or a
 * darker shade of the badge itself — whichever keeps it under the
 * keyhole rather than competing with it.
 */
type Tone = {
  ground: string;
  badge: string;
  stripe: string;
  stripeOpacity: number;
};

const TONES: Record<string, Tone> = {
  lime: { ground: LIME, badge: INK, stripe: LIME, stripeOpacity: 0.4 },
  ink: { ground: INK, badge: LIME, stripe: INK, stripeOpacity: 0.22 },
  pink: { ground: LIME, badge: HOT, stripe: HOT_DARK, stripeOpacity: 1 },
  hot: { ground: HOT, badge: INK, stripe: HOT, stripeOpacity: 0.4 },
  blue: { ground: LIME, badge: BLUE, stripe: BLUE_DARK, stripeOpacity: 1 },
};

export type MarkTone = keyof typeof TONES;

const about = (k: number) => `translate(32 33) scale(${k}) translate(-32 -33)`;

export function Mark({
  className = 'h-7 w-7',
  tone = 'lime',
}: {
  className?: string;
  tone?: MarkTone;
}) {
  const { ground, badge, stripe, stripeOpacity } = TONES[tone];
  const clip = `lyp-field-${tone}`;

  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Lock Your Picks"
    >
      <rect width="64" height="64" rx="14" fill={ground} />
      <path d={CREST} fill={badge} />
      <path d={CREST} fill={ground} transform={about(KEYLINE)} />
      <path d={CREST} fill={badge} transform={about(FIELD)} />

      <defs>
        <clipPath id={clip}>
          <path d={CREST} transform={about(FIELD)} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`} opacity={stripeOpacity}>
        <rect x="23" y="0" width="6" height="64" fill={stripe} />
        <rect x="35" y="0" width="6" height="64" fill={stripe} />
        <rect x="47" y="0" width="6" height="64" fill={stripe} />
      </g>

      <circle cx="32" cy="31" r="5.4" fill={ground} />
      <path d="M28.8 35.2 L35.2 35.2 L36.8 44 L27.2 44 Z" fill={ground} />
    </svg>
  );
}
