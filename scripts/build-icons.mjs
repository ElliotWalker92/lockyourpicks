/**
 * Cuts every icon file from one definition of the mark.
 *
 * `node scripts/build-icons.mjs` after changing anything below. The
 * output is committed, so this is not part of the build — it exists so
 * the eight files cannot be edited one at a time and drift.
 *
 * A club crest with a keyhole cut out of it, ink on lime. The crest is
 * the shape every football badge already is, so it reads as the right
 * kind of thing before it reads as anything at all; the keyhole keeps
 * the name in it. Solid ink on a bright ground rather than strokes on a
 * dark one, because that is what survives being 26 pixels wide on a home
 * screen full of other icons.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const INK = '#0d0d0d';
const LIME = '#c8f135';

const CREST =
  'M32 6 L55 13 V31 C55 45 45 55.5 32 60 C19 55.5 9 45 9 31 V13 Z';

/** Circle over a flared stem, the way a keyhole is actually shaped. */
const keyhole = (fill) => `
  <circle cx="32" cy="28" r="6.8" fill="${fill}"/>
  <path d="M27.9 33.3 L36.1 33.3 L38 45 L26 45 Z" fill="${fill}"/>`;

/** The mark on a 64-unit square, over whatever ground it is given. */
const glyph = (crestFill, holeFill) =>
  `<path d="${CREST}" fill="${crestFill}"/>${keyhole(holeFill)}`;

/**
 * `scale` shrinks the mark inside its square, for the maskable icon:
 * Android crops an adaptive icon to whatever shape the launcher uses, so
 * the crest has to sit well inside the safe circle. The lime goes edge
 * to edge either way, which is the point of a bright ground — the crop
 * takes lime, never the badge.
 */
const icon = ({ size, radius = 0, scale = 1 }) => {
  const inset = (64 - 64 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect width="64" height="64" rx="${radius}" fill="${LIME}"/>
  <g transform="translate(${inset} ${inset}) scale(${scale})">${glyph(INK, LIME)}</g>
</svg>`;
};

/**
 * The notification badge: Android keeps only the alpha channel, so the
 * keyhole has to be a hole rather than a lime shape, or it fills in and
 * the badge is a featureless blob.
 */
const badge = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <mask id="cut">
    <rect width="64" height="64" fill="black"/>
    <path d="${CREST}" fill="white"/>
    ${keyhole('black')}
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
