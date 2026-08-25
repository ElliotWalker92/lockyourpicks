/**
 * Division colours for the share cards.
 *
 * A plain module rather than living beside the component that draws them.
 * The pages that build slip sections are Server Components, and every export
 * of a `'use client'` module reaches the server as an opaque client
 * reference — reading `.length` off one gives undefined, so the index
 * silently becomes NaN and every division comes out with no colour at all.
 * Nothing throws, which is what makes it worth keeping apart.
 *
 * Electric blue is deliberately absent: it's the away side in every pill on
 * the card, and a division coloured the same would read as a claim about the
 * picks rather than a label on the slip.
 */
export const SLIP_ACCENTS = [
  '#c8f135', // lime
  '#ff2d87', // hot pink
  '#fbbf24', // amber
  '#a78bfa', // violet
  '#22d3ee', // cyan
  '#fb923c', // orange
];
