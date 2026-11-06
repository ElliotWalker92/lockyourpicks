/**
 * Cuts every icon file from one definition of the mark.
 *
 * `node scripts/build-icons.mjs` after changing anything below. The
 * output is committed, so this is not part of the build — it exists so
 * the eight files cannot be edited one at a time and drift.
 *
 * A padlock with a tick where the keyhole was: pink shackle, lime body,
 * the tick knocked out of it. Drawn once here so the favicon, the home
 * screen icon and the notification badge can never drift apart.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const INK = '#0d0d0d';
const LIME = '#c8f135';
const HOT = '#ff2d87';

const SHACKLE = 'M22 30 V22 a10 10 0 0 1 20 0 V30';
const BODY = { x: 11, y: 28, w: 42, h: 27, rx: 6 };
const TICK = 'M23 41 l6 6 l12 -12';

/** The mark, on a 64-unit square. */
const glyph = () => `
  <path d="${SHACKLE}" fill="none" stroke="${HOT}" stroke-width="5.5" stroke-linecap="round"/>
  <rect x="${BODY.x}" y="${BODY.y}" width="${BODY.w}" height="${BODY.h}" rx="${BODY.rx}" fill="${LIME}"/>
  <path d="${TICK}" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;

/**
 * `scale` shrinks the mark inside its square, for the maskable icon:
 * Android crops an adaptive icon to whatever shape the launcher uses, so
 * the mark has to sit well inside the safe circle.
 */
const icon = ({ size, radius = 0, scale = 1, bg = INK }) => {
  const inset = (64 - 64 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect width="64" height="64" rx="${radius}" fill="${bg}"/>
  <g transform="translate(${inset} ${inset}) scale(${scale})">${glyph()}</g>
</svg>`;
};

/**
 * The notification badge: Android keeps only the alpha channel, so the
 * tick has to be a hole rather than a dark shape or it fills in and the
 * badge is a featureless blob.
 */
const badge = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <mask id="cut">
    <rect width="64" height="64" fill="black"/>
    <path d="${SHACKLE}" fill="none" stroke="white" stroke-width="5.5" stroke-linecap="round"/>
    <rect x="${BODY.x}" y="${BODY.y}" width="${BODY.w}" height="${BODY.h}" rx="${BODY.rx}" fill="white"/>
    <path d="${TICK}" fill="none" stroke="black" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  </mask>
  <rect width="64" height="64" fill="white" mask="url(#cut)"/>
</svg>`;

const png = (name, svg) =>
  sharp(Buffer.from(svg)).png().toFile(join(OUT, name)).then(() => console.log('  ' + name));

(async () => {
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
})();
