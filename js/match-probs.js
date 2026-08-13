/**
 * match-probs.js
 *
 * Crowd pick % + Elo blend for a single match.
 *
 * Exposes three probability layers separately so the UI can display
 * any combination of them:
 *   .elo     — Elo-only win/draw/win (from team_elo ratings)
 *   .crowd   — raw crowd pick distribution (from predictions table)
 *   .blended — weighted blend of the two
 *
 * Example output:
 *   "Model: France 60.6%"  /  "Crowd: France 88.2%"  /  "Combined: France 67.4%"
 *
 * Depends on EloEngine (js/elo.js):
 *   Browser — load elo.js before this file; EloEngine is then a global
 *   Node    — auto-required from the sibling file
 */

// ---- EloEngine dependency ----
const _Elo = (function () {
  if (typeof EloEngine !== 'undefined') return EloEngine;       // browser global
  if (typeof require  !== 'undefined') return require('./elo.js'); // Node
  throw new Error('match-probs.js: EloEngine not available — load js/elo.js first');
}());

// ============================================================
// Blend weights  ← change here to recalibrate globally
// ============================================================

/** Default blend: 70 % Elo, 30 % crowd. Adjust to taste. */
const BLEND_WEIGHTS = { elo: 0.70, crowd: 0.30 };

/**
 * When fewer than this many picks are available, the crowd weight is
 * halved to reduce noise from tiny samples. The raw pickCount is always
 * returned so the UI can show a "based on N picks" label regardless.
 */
const MIN_CROWD_SIZE = 10;

// ============================================================
// Crowd picks
// ============================================================

/**
 * Derive crowd pick distribution from an array of prediction rows.
 * Each row must have a `value` field: JSON string '{"home":"2","away":"1"}'.
 * Implied outcome: home > away → home win; home = away → draw; home < away → away win.
 *
 * @param {Array<{value: string}>} picks
 * @returns {{ homeWin: number, draw: number, awayWin: number, pickCount: number } | null}
 *   null when there are no parseable picks.
 */
function computeCrowdPicks(picks) {
  let homeWin = 0, draw = 0, awayWin = 0;
  for (const p of picks) {
    let v;
    try { v = JSON.parse(p.value); } catch { continue; }
    const h = parseInt(v.home, 10), a = parseInt(v.away, 10);
    if (isNaN(h) || isNaN(a)) continue;
    if      (h > a) homeWin++;
    else if (h === a) draw++;
    else             awayWin++;
  }
  const total = homeWin + draw + awayWin;
  if (total === 0) return null;
  return {
    homeWin:   homeWin  / total,
    draw:       draw    / total,
    awayWin:   awayWin  / total,
    pickCount: total,
  };
}

/**
 * Fetch and compute crowd picks for a single match from Supabase.
 *
 * @param {number} matchId
 * @param {object} supabase  — Supabase client instance
 * @returns {Promise<{ homeWin, draw, awayWin, pickCount } | null>}
 */
async function getCrowdPicks(matchId, supabase) {
  const { data, error } = await supabase
    .from('predictions')
    .select('value')
    .eq('question_key', `m${matchId}`);
  if (error) throw error;
  return computeCrowdPicks(data ?? []);
}

// ============================================================
// Probability blend
// ============================================================

/**
 * Build all three probability layers for a match.
 *
 * WC2026 note: all group-stage matches are at neutral US/CAN/MEX venues
 * so no home-advantage adjustment is applied to Elo.
 *
 * Small-sample dampening: when pickCount < MIN_CROWD_SIZE the crowd weight
 * is halved (Elo absorbs the difference). The applied weights are returned
 * so callers can show the effective split if needed.
 *
 * @param {number} homeRating   current Elo for the listed home team
 * @param {number} awayRating   current Elo for the listed away team
 * @param {{ homeWin, draw, awayWin, pickCount } | null} crowdPicks
 * @param {{ elo: number, crowd: number }} [weights]  override BLEND_WEIGHTS
 * @returns {{
 *   elo:      { homeWin: number, draw: number, awayWin: number },
 *   crowd:    { homeWin: number, draw: number, awayWin: number, pickCount: number } | null,
 *   blended:  { homeWin: number, draw: number, awayWin: number },
 *   pickCount: number,
 *   weights:  { elo: number, crowd: number }
 * }}
 */
function getMatchProbs(homeRating, awayRating, crowdPicks, weights) {
  const w = weights ?? BLEND_WEIGHTS;

  // Elo three-way probabilities, neutral venue
  const eloRaw = _Elo.getEloProbabilities(homeRating, awayRating, { neutral: true });
  const elo    = { homeWin: eloRaw.winA, draw: eloRaw.draw, awayWin: eloRaw.winB };

  if (!crowdPicks || crowdPicks.pickCount === 0) {
    return { elo, crowd: null, blended: elo, pickCount: 0, weights: w };
  }

  // Dampen crowd weight for small samples
  const appliedW = crowdPicks.pickCount < MIN_CROWD_SIZE
    ? { elo: w.elo + w.crowd * 0.5, crowd: w.crowd * 0.5 }
    : w;

  // EloEngine.blend uses { winA, draw, winB } convention (A = home)
  const blendedRaw = _Elo.blend(
    { elo:   { winA: elo.homeWin,        draw: elo.draw,        winB: elo.awayWin   },
      crowd: { winA: crowdPicks.homeWin, draw: crowdPicks.draw, winB: crowdPicks.awayWin } },
    appliedW
  );

  return {
    elo,
    crowd:    crowdPicks,
    blended:  { homeWin: blendedRaw.winA, draw: blendedRaw.draw, awayWin: blendedRaw.winB },
    pickCount: crowdPicks.pickCount,
    weights:   appliedW,
  };
}

// ============================================================
// Formatting helpers
// ============================================================

/** Render a probability as a percentage string, e.g. "60.6%". */
function pct(p) { return (p * 100).toFixed(1) + '%'; }

/**
 * Human-readable one-line summary of a probability set.
 * @param {{ homeWin, draw, awayWin }} probs
 * @param {string} homeName
 * @param {string} awayName
 * @returns {string}  e.g. "France 60.6%  /  Draw 19.2%  /  Norway 20.2%"
 */
function formatProbs(probs, homeName, awayName) {
  return `${homeName} ${pct(probs.homeWin)}  /  Draw ${pct(probs.draw)}  /  ${awayName} ${pct(probs.awayWin)}`;
}

// ============================================================
// Exports
// ============================================================
const MatchProbs = {
  BLEND_WEIGHTS,
  MIN_CROWD_SIZE,
  computeCrowdPicks,
  getCrowdPicks,
  getMatchProbs,
  pct,
  formatProbs,
};

if (typeof window !== 'undefined') window.MatchProbs = MatchProbs;
if (typeof module !== 'undefined') module.exports   = MatchProbs;
