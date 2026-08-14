/**
 * Elo → win/draw/loss probabilities.
 *
 * Ported from the WC2026 app (`legacy/js/elo.js`) with the maths unchanged.
 * The one thing worth noting is that `HOME_ADV` finally earns its keep here:
 * World Cup matches are played at neutral venues, so the home-advantage term
 * was mostly dormant. Domestic league fixtures have a real home side.
 *
 * Also used server-side by `auto_pick()` in
 * `supabase/migrations/0002_draft_functions.sql`, which applies the same
 * +100 home advantage when a turn expires. If you change HOME_ADV here,
 * change it there too.
 */

export interface Probabilities {
  /** Home win. Sums to 1 with `draw` and `away`. */
  home: number;
  draw: number;
  away: number;
}

/** Elo points added to the home team's effective rating. */
export const HOME_ADV = 100;

/** Draw probability when two teams are exactly level (~24%). */
export const DRAW_BASE = 0.24;

/**
 * How fast draw probability decays as the rating gap widens.
 *   P(draw) = DRAW_BASE × exp(−ΔR² / DRAW_SIGMA2)
 *     ΔR =   0 → 24.0%
 *     ΔR = 100 → 21.7%
 *     ΔR = 200 → 16.3%
 *     ΔR = 400 →  5.2%
 */
export const DRAW_SIGMA2 = 100_000;

/**
 * Standard two-outcome Elo expected score: P(win) + ½·P(draw).
 */
export function expectedScore(
  ratingA: number,
  ratingB: number,
  homeAdv = 0,
): number {
  const dr = ratingA + homeAdv - ratingB;
  return 1 / (1 + Math.pow(10, -dr / 400));
}

/**
 * Three-way probabilities for a fixture.
 *
 * @param homeRating Elo of the home side
 * @param awayRating Elo of the away side
 * @param neutral    true for a neutral venue (cup finals) — drops home advantage
 */
export function matchProbabilities(
  homeRating: number,
  awayRating: number,
  { neutral = false }: { neutral?: boolean } = {},
): Probabilities {
  const dr = homeRating + (neutral ? 0 : HOME_ADV) - awayRating;

  const expected = 1 / (1 + Math.pow(10, -dr / 400));
  const rawDraw = DRAW_BASE * Math.exp(-(dr * dr) / DRAW_SIGMA2);

  // expected = P(home) + ½·P(draw)  ⇒  P(home) = expected − draw/2
  const home = Math.max(0, expected - rawDraw / 2);
  const away = Math.max(0, 1 - expected - rawDraw / 2);
  const draw = Math.max(0, rawDraw);

  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}

/**
 * The outcome the model considers most likely.
 *
 * Note this can never return 'DRAW': under this model a draw peaks at ~24% and
 * is never the single most likely result. `auto_pick()` relies on the same
 * property, and picks the favourite rather than the draw.
 */
export function favouredOutcome(
  probs: Probabilities,
): 'HOME' | 'DRAW' | 'AWAY' {
  if (probs.home >= probs.away && probs.home >= probs.draw) return 'HOME';
  if (probs.away >= probs.draw) return 'AWAY';
  return 'DRAW';
}

/**
 * How lopsided a fixture is, 0–1. Used to rank fixtures by confidence — the
 * draft's auto-pick takes the highest.
 */
export function confidence(probs: Probabilities): number {
  return Math.max(probs.home, probs.draw, probs.away);
}

/**
 * Weighted blend of probability sources.
 *
 * Carried over so crowd data (how a division actually drafted) can be mixed in
 * later without touching the Elo maths.
 */
export function blend(
  sources: Record<string, Probabilities>,
  weights: Record<string, number> = {},
): Probabilities {
  const keys = Object.keys(sources);
  if (keys.length === 0) throw new Error('blend: no sources given');

  let totalWeight = 0;
  const w: Record<string, number> = {};
  for (const k of keys) {
    w[k] = weights[k] ?? 1;
    totalWeight += w[k];
  }

  const out: Probabilities = { home: 0, draw: 0, away: 0 };
  for (const k of keys) {
    const weight = w[k] / totalWeight;
    out.home += sources[k].home * weight;
    out.draw += sources[k].draw * weight;
    out.away += sources[k].away * weight;
  }
  return out;
}

export const formatPct = (p: number): string => `${(p * 100).toFixed(1)}%`;
