import { HOME_ADV, matchProbabilities, type Probabilities } from '@/lib/elo';

/**
 * The prediction model: Elo, recent form, and the crowd, blended.
 *
 * Each layer is exposed separately so the UI can show what each thinks, not
 * just the combined number. A single blended percentage hides whether the
 * model and the crowd agree — which is the interesting part.
 */

export type ModelLayers = {
  elo: Probabilities;
  form: Probabilities | null;
  crowd: (Probabilities & { sample: number }) | null;
  blended: Probabilities;
  /** Weights actually used, after any small-sample adjustment. */
  weights: { elo: number; form: number; crowd: number };
};

/** Starting point. Crowd is deliberately the smallest — see below. */
const BASE_WEIGHTS = { elo: 0.6, form: 0.25, crowd: 0.15 };

/**
 * Below this many picks the crowd is noise, so its weight is scaled down in
 * proportion and handed back to Elo and form.
 *
 * In this game a fixture can be taken at most once per division, so even a
 * healthy league produces single-digit samples — nothing like the WC2026 app,
 * where everyone predicted every match. The threshold is low for that reason,
 * and the crowd never gets a large weight regardless.
 */
const MIN_CROWD = 6;

export type FormRun = {
  /** Most recent last: 'W' | 'D' | 'L'. */
  results: ('W' | 'D' | 'L')[];
  /** Points per game over the run, 0–3. */
  ppg: number;
};

const POINTS = { W: 3, D: 1, L: 0 } as const;

/**
 * Recent form as points per game, most recent weighted highest.
 *
 * A flat average treats a win five games ago as equal to one last week. The
 * linear weighting is crude but directionally right, and honest about being a
 * small sample — `results` is returned so the UI can show the actual run
 * rather than only a derived number.
 */
export function formRun(results: ('W' | 'D' | 'L')[]): FormRun {
  if (results.length === 0) return { results, ppg: 0 };

  let weighted = 0;
  let totalWeight = 0;
  results.forEach((r, i) => {
    const weight = i + 1; // oldest first, so later entries weigh more
    weighted += POINTS[r] * weight;
    totalWeight += weight;
  });

  return { results, ppg: weighted / totalWeight };
}

/**
 * Turn two form runs into three-way probabilities.
 *
 * Maps the points-per-game gap onto the same Elo curve rather than inventing a
 * second scale: a full 3.0 ppg advantage is treated as roughly 200 rating
 * points, which is a real but not overwhelming edge. Reusing the curve means
 * the draw probability behaves consistently across layers.
 */
export function formProbabilities(
  home: FormRun,
  away: FormRun,
): Probabilities | null {
  if (home.results.length === 0 || away.results.length === 0) return null;

  const PER_PPG = 200 / 3;
  return matchProbabilities(1500 + home.ppg * PER_PPG, 1500 + away.ppg * PER_PPG);
}

/** Crowd distribution from raw pick counts. */
export function crowdProbabilities(counts: {
  home: number;
  draw: number;
  away: number;
}): (Probabilities & { sample: number }) | null {
  const sample = counts.home + counts.draw + counts.away;
  if (sample === 0) return null;
  return {
    home: counts.home / sample,
    draw: counts.draw / sample,
    away: counts.away / sample,
    sample,
  };
}

function normalise(p: Probabilities): Probabilities {
  const total = p.home + p.draw + p.away;
  if (total === 0) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  return { home: p.home / total, draw: p.draw / total, away: p.away / total };
}

export function buildModel({
  homeElo,
  awayElo,
  homeForm,
  awayForm,
  crowdCounts,
  neutral = false,
}: {
  homeElo: number;
  awayElo: number;
  homeForm: FormRun;
  awayForm: FormRun;
  crowdCounts: { home: number; draw: number; away: number };
  neutral?: boolean;
}): ModelLayers {
  const elo = matchProbabilities(homeElo, awayElo, { neutral });
  const form = formProbabilities(homeForm, awayForm);
  const crowd = crowdProbabilities(crowdCounts);

  // Start from the base and drop any layer we haven't got.
  const weights = { ...BASE_WEIGHTS };
  if (!form) weights.form = 0;
  if (!crowd) weights.crowd = 0;
  else if (crowd.sample < MIN_CROWD) {
    weights.crowd = BASE_WEIGHTS.crowd * (crowd.sample / MIN_CROWD);
  }

  // Redistribute whatever's left over onto Elo, which is the layer we trust
  // most and the only one always present.
  const used = weights.elo + weights.form + weights.crowd;
  weights.elo += 1 - used;

  const blended = normalise({
    home:
      elo.home * weights.elo +
      (form?.home ?? 0) * weights.form +
      (crowd?.home ?? 0) * weights.crowd,
    draw:
      elo.draw * weights.elo +
      (form?.draw ?? 0) * weights.form +
      (crowd?.draw ?? 0) * weights.crowd,
    away:
      elo.away * weights.elo +
      (form?.away ?? 0) * weights.form +
      (crowd?.away ?? 0) * weights.crowd,
  });

  return { elo, form, crowd, blended, weights };
}

export { HOME_ADV };
