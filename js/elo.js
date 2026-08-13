/**
 * EloEngine — win/draw/loss probability from Elo ratings.
 *
 * Each public function returns a ProbabilityResult:
 *   { winA: number, draw: number, winB: number }   (sum = 1.0)
 *
 * Designed as a "probability source":  getEloProbabilities() returns
 * a ProbabilityResult that blend() can combine with other sources
 * (crowd pick %, market odds) without touching this module.
 *
 * Usage:
 *   const probs = EloEngine.getEloProbabilities(ratingA, ratingB);
 *   EloEngine.format(probs, 'France', 'Norway');
 *   // → "France 72.4%  /  Draw 18.9%  /  Norway 8.7%"
 *
 *   // Future blend with crowd data:
 *   const final = EloEngine.blend(
 *     { elo: probs, crowd: crowdSource },
 *     { elo: 0.7,   crowd: 0.3 }
 *   );
 */
const EloEngine = (() => {

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  /** Elo points added to home team's effective rating (not neutral venue) */
  const HOME_ADV = 100;

  /** Baseline draw probability when the two teams have identical ratings (~24%) */
  const DRAW_BASE = 0.24;

  /**
   * Controls how fast draw probability falls as the Elo gap widens.
   * P(draw) = DRAW_BASE × exp(−ΔR² / DRAW_SIGMA2)
   *   ΔR=   0 → 24.0%   (equal teams)
   *   ΔR= 100 → 21.7%
   *   ΔR= 200 → 16.3%
   *   ΔR= 400 →  5.2%
   */
  const DRAW_SIGMA2 = 100_000;

  // -----------------------------------------------------------------------
  // Core formula
  // -----------------------------------------------------------------------

  /**
   * Elo expected score for team A:  P(A wins) + 0.5 × P(draw).
   * This is the standard two-outcome formula; use getEloProbabilities for
   * three-way win/draw/loss.
   *
   * @param {number} ratingA
   * @param {number} ratingB
   * @param {number} [homeAdv=0]  pass HOME_ADV when A is playing at home
   * @returns {number}  expected score, 0–1
   */
  function expectedScore(ratingA, ratingB, homeAdv = 0) {
    const dr = ratingA + homeAdv - ratingB;
    return 1 / (1 + Math.pow(10, -dr / 400));
  }

  /**
   * Three-way win/draw/loss probabilities from Elo ratings.
   *
   * @param {number} ratingA            current Elo for team A
   * @param {number} ratingB            current Elo for team B
   * @param {object} [opts]
   * @param {boolean} [opts.neutral=true]      true = neutral venue (no home advantage)
   * @param {boolean} [opts.homeTeamIsA=false] when neutral=false, is A the home team?
   * @returns {{ winA: number, draw: number, winB: number }}
   */
  function getEloProbabilities(ratingA, ratingB, opts = {}) {
    const { neutral = true, homeTeamIsA = false } = opts;
    const homeAdv = neutral ? 0 : (homeTeamIsA ? HOME_ADV : -HOME_ADV);
    const dr      = ratingA + homeAdv - ratingB;

    // Standard Elo expected score (P(win) + 0.5 × P(draw))
    const eA = 1 / (1 + Math.pow(10, -dr / 400));

    // Draw probability — peaks when ratings are equal, falls with the gap
    const rawDraw = DRAW_BASE * Math.exp(-(dr * dr) / DRAW_SIGMA2);

    // Three-way split derived from Elo expected score
    // eA = P(A wins) + 0.5 × P(draw)  →  P(A wins) = eA − draw/2
    const winA = Math.max(0, eA - rawDraw / 2);
    const winB = Math.max(0, (1 - eA) - rawDraw / 2);
    const draw  = Math.max(0, rawDraw);

    // Normalise to sum exactly to 1
    const total = winA + draw + winB;
    return {
      winA: winA / total,
      draw: draw / total,
      winB: winB / total,
    };
  }

  // -----------------------------------------------------------------------
  // Blend interface
  //
  // Accepts a dict of ProbabilityResult sources and optional weight map.
  // Today only Elo is wired in; adding crowd picks or market odds later
  // requires only calling blend() with new entries — no changes here.
  //
  // Example (future):
  //   EloEngine.blend(
  //     { elo: eloProbs, crowd: crowdProbs, odds: marketProbs },
  //     { elo: 0.5, crowd: 0.25, odds: 0.25 }
  //   )
  // -----------------------------------------------------------------------

  /**
   * Weighted blend of probability sources.
   *
   * @param {{ [name: string]: { winA: number, draw: number, winB: number } }} sources
   * @param {{ [name: string]: number }} [weights]  defaults to equal weights
   * @returns {{ winA: number, draw: number, winB: number }}
   */
  function blend(sources, weights = {}) {
    const keys = Object.keys(sources);
    if (keys.length === 0) throw new Error('EloEngine.blend: no sources');

    let totalW = 0;
    const w = {};
    for (const k of keys) { w[k] = weights[k] ?? 1; totalW += w[k]; }

    const out = { winA: 0, draw: 0, winB: 0 };
    for (const k of keys) {
      const wt = w[k] / totalW;
      out.winA += sources[k].winA * wt;
      out.draw  += sources[k].draw  * wt;
      out.winB += sources[k].winB * wt;
    }
    return out;
  }

  // -----------------------------------------------------------------------
  // Formatting helpers
  // -----------------------------------------------------------------------

  /** Render a probability as a percentage string. */
  function pct(p) { return (p * 100).toFixed(1) + '%'; }

  /**
   * Human-readable summary of a ProbabilityResult.
   * @param {{ winA, draw, winB }} probs
   * @param {string} [labelA='A']
   * @param {string} [labelB='B']
   */
  function format(probs, labelA = 'A', labelB = 'B') {
    return `${labelA} ${pct(probs.winA)}  /  Draw ${pct(probs.draw)}  /  ${labelB} ${pct(probs.winB)}`;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------
  return {
    HOME_ADV,
    DRAW_BASE,
    DRAW_SIGMA2,
    expectedScore,       // two-outcome expected score (internal / advanced use)
    getEloProbabilities, // primary entry point for three-way win/draw/loss
    blend,               // combine multiple probability sources
    pct,
    format,
  };
})();

if (typeof window !== 'undefined') window.EloEngine = EloEngine;
if (typeof module !== 'undefined') module.exports = EloEngine;
