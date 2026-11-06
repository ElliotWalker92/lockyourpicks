/**
 * Cuts every icon file from one definition of the mark.
 *
 * `node scripts/build-icons.mjs` after changing anything below. The
 * output is committed, so this is not part of the build — it exists so
 * the eight files cannot be edited one at a time and drift.
 *
 * A club badge: flat top, rounded shoulders, a keyline inside the edge
 * the way nearly every real crest has one, three bold shirt stripes
 * running the full height behind a keyhole.
 *
 * Two ways round. The home-screen icons are ink on a lime tile, which
 * needs the tile: on a launcher there is nothing behind them. The
 * favicons are the badge alone, lime with ink detail, which is the way
 * round that holds up on both a light and a dark tab strip.
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

/**
 * The badge itself: a solid shape, with the keyline, the stripes and the
 * keyhole painted in `detail` rather than cut out, so it composites onto
 * anything without needing the ground behind it to be a known colour.
 */
const glyph = (id, badge, detail) =>
  `${crest(badge)}${crest(detail, KEYLINE)}${crest(badge, FIELD)}${stripes(id, detail, 0.4)}${keyhole(detail)}`;

/**
 * `scale` shrinks the mark inside its square, for the maskable icon:
 * Android crops an adaptive icon to whatever shape the launcher uses, so
 * the badge has to sit well inside the safe circle.
 */
const icon = ({ size, radius = 0, scale = 1 }) => {
  const inset = (64 - 64 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <rect width="64" height="64" rx="${radius}" fill="${LIME}"/>
  <g transform="translate(${inset} ${inset}) scale(${scale})">${glyph('s' + size, INK, LIME)}</g>
</svg>`;
};

/**
 * The favicon: the badge on its own, no tile.
 *
 * Lime badge with ink detail, which is the way round that survives both
 * a light tab strip and a dark one — an ink badge vanishes into dark
 * browser chrome, and there is no tile left to hold it up. Tested at 16
 * and 32 against both before choosing.
 */
const favicon = (size) => {
  // The badge is drawn with the margin a tile needs around it. With no
  // tile that margin is just empty canvas, and a favicon has 16 pixels
  // to work with — so it is scaled to fill, keeping a hair of
  // air top and bottom. Its box is 44 x 48 inside the 64 square.
  const k = 1.24;
  const tx = (64 - 44 * k) / 2 - 10 * k;
  const ty = (64 - 48 * k) / 2 - 11 * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k})">${glyph('f' + size, LIME, INK)}</g>
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

/**
 * An .ico, which sharp cannot write.
 *
 * It is a six-byte header, a sixteen-byte directory entry per image and
 * then the images, which since Vista may be PNGs rather than bitmaps.
 * Worth the thirty lines: it is the one icon old browsers and a few
 * Windows surfaces still ask for, and left alone it quietly keeps
 * serving whatever logo the app used to have.
 */
const ico = async (sizes) => {
  const images = await Promise.all(
    sizes.map((size) => sharp(Buffer.from(favicon(size))).png().toBuffer()),
  );

  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // 1 = icon, not cursor
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const entries = images.map((data, i) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 0); // 0 means 256
    entry.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images]);
};

const png = (name, svg) =>
  sharp(Buffer.from(svg)).png().toFile(join(OUT, name)).then(() => console.log('  ' + name));

writeFileSync(join(OUT, 'favicon.svg'), favicon(64) + '\n');
console.log('  favicon.svg');

await Promise.all([
  png('favicon-16x16.png', favicon(16)),
  png('favicon-32x32.png', favicon(32)),
  png('apple-touch-icon.png', icon({ size: 180 })),
  png('icon-192.png', icon({ size: 192 })),
  png('icon-512.png', icon({ size: 512 })),
  png('icon-maskable-512.png', icon({ size: 512, scale: 0.62 })),
  png('badge-96.png', badge(96)),
]);

writeFileSync(join(OUT, 'favicon.ico'), await ico([16, 32, 48]));
console.log('  favicon.ico');
