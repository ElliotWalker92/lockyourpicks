import { HOME_ADV, matchProbabilities, type Probabilities } from '@/lib/elo';

/**
 * The prediction model: Elo, the league table, recent form, and the crowd.
 *
 * Each layer is exposed separately so the UI can show what each thinks, not
 * just the combined number. A single blended percentage hides whether the
 * model and the crowd agree — which is the interesting part.
 */

export type ModelLayers = {
  elo: Probabilities;
  table: (Probabilities & { sample: number }) | null;
  form: Probabilities | null;
  crowd: (Probabilities & { sample: number }) | null;
  blended: Probabilities;
  /** Weights actually used, after any small-sample adjustment. */
  weights: { elo: number; table: number; form: number; crowd: number };
};

/**
 * Starting point.
 *
 * Elo stays the backbone: it is the only layer that spans competitions, so
 * it is the one that can price a Premier League side against a League Two
 * side in a cup tie. The table is worth a fifth on its own account because
 * it is read by venue — see tableProbabilities. Crowd is deliberately the
 * smallest.
 */
const BASE_WEIGHTS = { elo: 0.45, table: 0.2, form: 0.2, crowd: 0.15 };

/**
 * Home and away records below this many games are too thin to price.
 *
 * A team three games into a season has played one or two at home; its home
 * points-per-game is 0 or 3 and means nothing. Weight scales up to this and
 * is handed back to Elo until then.
 */
const MIN_TABLE_GAMES = 5;

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

/**
 * One side's league record at a given venue.
 *
 * `competitionId` is carried so two teams are only ever compared within the
 * same division.
 */
export type TableRecord = {
  /** Points per game — at home for the home side, away for the away side. */
  ppg: number;
  /** Games played at that venue. */
  played: number;
  competitionId: string;
  rank: number;
};

/**
 * Turn two league records into three-way probabilities.
 *
 * Read by venue: the home side's home record against the away side's away
 * record. That is the part Elo cannot see — it applies the same hundred-point
 * home advantage to everyone, while real sides differ enormously in how much
 * home is worth to them. Because the venue is already baked into both
 * numbers, the curve is asked for a neutral venue; adding the usual home
 * advantage on top would count it twice.
 *
 * Returns null when the two sides are not in the same competition. Points per
 * game only compares within a division — a League Two leader out-scores a
 * mid-table Premier League side on that measure and is plainly not better, so
 * for a cup tie across divisions this layer has nothing to say and stands
 * aside for Elo, which is seeded by tier and does.
 */
export function tableProbabilities(
  home: TableRecord | null,
  away: TableRecord | null,
): (Probabilities & { sample: number }) | null {
  if (!home || !away) return null;
  if (home.competitionId !== away.competitionId) return null;
  if (home.played === 0 || away.played === 0) return null;

  const PER_PPG = 200 / 3;
  const p = matchProbabilities(
    1500 + home.ppg * PER_PPG,
    1500 + away.ppg * PER_PPG,
    { neutral: true },
  );

  return { ...p, sample: Math.min(home.played, away.played) };
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
  homeTable = null,
  awayTable = null,
  homeForm,
  awayForm,
  crowdCounts,
  neutral = false,
}: {
  homeElo: number;
  awayElo: number;
  homeTable?: TableRecord | null;
  awayTable?: TableRecord | null;
  homeForm: FormRun;
  awayForm: FormRun;
  crowdCounts: { home: number; draw: number; away: number };
  neutral?: boolean;
}): ModelLayers {
  const elo = matchProbabilities(homeElo, awayElo, { neutral });
  const table = tableProbabilities(homeTable, awayTable);
  const form = formProbabilities(homeForm, awayForm);
  const crowd = crowdProbabilities(crowdCounts);

  // Start from the base and drop any layer we haven't got.
  const weights = { ...BASE_WEIGHTS };
  if (!table) weights.table = 0;
  else if (table.sample < MIN_TABLE_GAMES) {
    weights.table = BASE_WEIGHTS.table * (table.sample / MIN_TABLE_GAMES);
  }
  if (!form) weights.form = 0;
  if (!crowd) weights.crowd = 0;
  else if (crowd.sample < MIN_CROWD) {
    weights.crowd = BASE_WEIGHTS.crowd * (crowd.sample / MIN_CROWD);
  }

  // Redistribute whatever's left over onto Elo, which is the layer we trust
  // most and the only one always present.
  const used = weights.elo + weights.table + weights.form + weights.crowd;
  weights.elo += 1 - used;

  const blended = normalise({
    home:
      elo.home * weights.elo +
      (table?.home ?? 0) * weights.table +
      (form?.home ?? 0) * weights.form +
      (crowd?.home ?? 0) * weights.crowd,
    draw:
      elo.draw * weights.elo +
      (table?.draw ?? 0) * weights.table +
      (form?.draw ?? 0) * weights.form +
      (crowd?.draw ?? 0) * weights.crowd,
    away:
      elo.away * weights.elo +
      (table?.away ?? 0) * weights.table +
      (form?.away ?? 0) * weights.form +
      (crowd?.away ?? 0) * weights.crowd,
  });

  return { elo, table, form, crowd, blended, weights };
}

export { HOME_ADV };
