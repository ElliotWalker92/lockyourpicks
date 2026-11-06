/**
 * Cuts every icon file from one definition of the mark.
 *
 * `node scripts/build-icons.mjs` after changing anything below. The
 * output is committed, so this is not part of the build — it exists so
 * the eight files cannot be edited one at a time and drift.
 *
 * A club badge: flat top, rounded shoulders, a keyline inside the edge
 * the way nearly every real crest has one, three bold shirt stripes
 * running the full height behind a keyhole. Ink on lime.
 *
 * Solid shapes on a bright ground rather than strokes on a dark one,
 * because that is what survives being 26 pixels wide on a home screen
 * next to other apps — and the lime goes edge to edge, so Android's
 * adaptive crop takes ground rather than badge.
 *
 * The stripes are lime at 40% over the ink, not solid lime: at full
 * strength they are the same value as the keyhole and swallow it.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const INK = '#0d0d0d';
const LIME = '#c8f135';

/** The badge outline, and the two rings cut inside it. */
const CREST = 'M10 11 H54 V31 C54 44 45 53.5 32 59 C19 53.5 10 44 10 31 Z';
const KEYLINE = 0.9;
const FIELD = 0.81;

const about = (k) => `translate(32 33) scale(${k}) translate(-32 -33)`;
const crest = (fill, k = 1) =>
  `<path d="${CREST}" fill="${fill}" transform="${about(k)}"/>`;

/** Three bold stripes, full height, clipped to the field inside the keyline. */
const stripes = (id, fill, opacity) => {
  const pitch = 12;
  const bars = [0, 1, 2]
    .map((i) => {
      const cx = 20 + pitch / 2 + i * pitch;
      return `<rect x="${cx - 3}" y="0" width="6" height="64" fill="${fill}" opacity="${opacity}"/>`;
    })
    .join('');
  return `<defs><clipPath id="${id}"><path d="${CREST}" transform="${about(FIELD)}"/></clipPath></defs>
    <g clip-path="url(#${id})">${bars}</g>`;
};

/** Circle over a flared stem, the way a keyhole is actually shaped. */
const keyhole = (fill) => `
  <circle cx="32" cy="31" r="5.4" fill="${fill}"/>
  <path d="M28.8 35.2 L35.2 35.2 L36.8 44 L27.2 44 Z" fill="${fill}"/>`;

const glyph = (id) =>
  `${crest(INK)}${crest(LIME, KEYLINE)}${crest(INK, FIELD)}${stripes(id, LIME, 0.4)}${keyhole(LIME)}`;

/**
 * `scale` shrinks the mark inside its square, for the maskable icon:
 * Android crops an adaptive icon to whatever shape the launcher uses, so
 * the badge has to sit well inside the safe circle.
 */
const icon = ({ size, radius = 0, scale = 1 }) => {
  const inset = (64 - 64 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect width="64" height="64" rx="${radius}" fill="${LIME}"/>
  <g transform="translate(${inset} ${inset}) scale(${scale})">${glyph('s' + size)}</g>
</svg>`;
};

/**
 * The notification badge: Android keeps only the alpha channel, so every
 * light part has to be a hole rather than a pale shape, or it fills in
 * and the badge is a featureless blob. Keyline and keyhole are holes;
 * the stripes are dropped, being too fine to survive at badge size.
 */
const badge = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <mask id="cut">
    <rect width="64" height="64" fill="black"/>
    ${crest('white')}${crest('black', KEYLINE)}${crest('white', FIELD)}${keyhole('black')}
  </mask>
  <rect width="64" height="64" fill="white" mask="url(#cut)"/>
</svg>`;

const png = (name, svg) =>
  sharp(Buffer.from(svg)).png().toFile(join(OUT, name)).then(() => console.log('  ' + name));

writeFileSync(join(OUT, 'favicon.svg'), icon({ size: 64, radius: 14 }) + '\n');
console.log('  favicon.svg');

await Promise.all([
  png('favicon-16x16.png', icon({ size: 16 })),
  png('favicon-32x32.png', icon({ size: 32 })),
  png('apple-touch-icon.png', icon({ size: 180 })),
  png('icon-192.png', icon({ size: 192 })),
  png('icon-512.png', icon({ size: 512 })),
  png('icon-maskable-512.png', icon({ size: 512, scale: 0.62 })),
  png('badge-96.png', badge(96)),
]);
