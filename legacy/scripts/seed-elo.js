#!/usr/bin/env node
/**
 * scripts/seed-elo.js
 *
 * Computes Elo ratings for all 48 WC2026 teams from the
 * martj42 "International football results 1872–present" dataset.
 *
 * Processes all matches UP TO and including SEED_CUTOFF (June 10, 2026 —
 * the day before WC2026 kicks off). WC match Elo deltas are applied by
 * the elo-update edge function from match_results so nothing is double-counted.
 *
 * Usage:
 *   node scripts/seed-elo.js           # ratings table + probability examples
 *   node scripts/seed-elo.js --sql     # also emit SQL for Supabase
 *
 * Requirements: Node 18+ (built-in fetch)
 */

const DATASET_URL = 'https://raw.githubusercontent.com/martj42/international_results/master/results.csv';
const SEED_CUTOFF = '2026-06-10';  // inclusive; WC2026 starts 2026-06-11

// -----------------------------------------------------------------------
// Country name → WC2026 team code
// Verified against actual dataset strings (June 2026 scrape).
// Notes:
//   "Germany"             — dataset uses this throughout; no "West Germany" entry
//   "Czech Republic"      — dataset uses this; no "Czechia" entry
//   "Turkey"              — dataset uses this; no "Türkiye" entry
//   "Ivory Coast"         — dataset uses this; no "Côte d'Ivoire" entry
//   "DR Congo"            — dataset uses this throughout; no "Zaire" entry
//   "Curaçao"             — with accent; no "Netherlands Antilles" entry
//   "South Korea"         — used throughout (not "Korea Republic")
//   "United States"       — full name (not "USA")
//   "Iran"                — used throughout (not "IR Iran")
// -----------------------------------------------------------------------
const NAME_TO_CODE = {
  // North/Central America & Caribbean
  'Mexico':                   'MEX',
  'Canada':                   'CAN',
  'United States':            'USA',
  'Haiti':                    'HAI',
  'Panama':                   'PAN',
  'Curaçao':                  'CUW',
  // South America
  'Brazil':                   'BRA',
  'Argentina':                'ARG',
  'Colombia':                 'COL',
  'Uruguay':                  'URU',
  'Ecuador':                  'ECU',
  'Paraguay':                 'PAR',
  // Europe
  'England':                  'ENG',
  'Scotland':                 'SCO',
  'France':                   'FRA',
  'Germany':                  'GER',
  'Spain':                    'ESP',
  'Netherlands':              'NED',
  'Belgium':                  'BEL',
  'Portugal':                 'POR',
  'Croatia':                  'CRO',
  'Switzerland':              'SUI',
  'Norway':                   'NOR',
  'Sweden':                   'SWE',
  'Austria':                  'AUT',
  'Czech Republic':           'CZE',
  'Bosnia and Herzegovina':   'BIH',
  // Africa
  'South Africa':             'RSA',
  'Morocco':                  'MAR',
  'Tunisia':                  'TUN',
  'Egypt':                    'EGY',
  'Senegal':                  'SEN',
  'Ivory Coast':              'CIV',
  'Ghana':                    'GHA',
  'Algeria':                  'ALG',
  'DR Congo':                 'COD',
  'Cape Verde':               'CPV',
  // Asia & Oceania
  'South Korea':              'KOR',
  'Japan':                    'JPN',
  'Australia':                'AUS',
  'Iran':                     'IRN',
  'Saudi Arabia':             'KSA',
  'Qatar':                    'QAT',
  'Iraq':                     'IRQ',
  'Jordan':                   'JOR',
  'Uzbekistan':               'UZB',
  'New Zealand':              'NZL',
  // Renamed (dataset uses pre-rename strings throughout)
  'Turkey':                   'TUR',
};

// Display names for the output table
const DISPLAY_NAME = {
  MEX:'Mexico', RSA:'South Africa', KOR:'South Korea', CZE:'Czechia',
  CAN:'Canada', BIH:'Bosnia & Herz.', QAT:'Qatar', SUI:'Switzerland',
  BRA:'Brazil', MAR:'Morocco', HAI:'Haiti', SCO:'Scotland',
  USA:'USA', PAR:'Paraguay', AUS:'Australia', TUR:'Türkiye',
  GER:'Germany', CUW:'Curaçao', CIV:'Ivory Coast', ECU:'Ecuador',
  NED:'Netherlands', JPN:'Japan', SWE:'Sweden', TUN:'Tunisia',
  BEL:'Belgium', EGY:'Egypt', IRN:'Iran', NZL:'New Zealand',
  ESP:'Spain', CPV:'Cape Verde', KSA:'Saudi Arabia', URU:'Uruguay',
  FRA:'France', SEN:'Senegal', IRQ:'Iraq', NOR:'Norway',
  ARG:'Argentina', ALG:'Algeria', AUT:'Austria', JOR:'Jordan',
  POR:'Portugal', COD:'DR Congo', UZB:'Uzbekistan', COL:'Colombia',
  ENG:'England', CRO:'Croatia', GHA:'Ghana', PAN:'Panama',
};

// -----------------------------------------------------------------------
// Elo algorithm
// -----------------------------------------------------------------------
const HOME_ADV    = 100;
const BASE_RATING = 1500;

/** K factor by tournament type. */
function kFactor(tournament) {
  const t = (tournament || '').toLowerCase();
  if (t === 'fifa world cup')                               return 60;
  if (t.includes('world cup'))                              return 40;  // qualifiers
  if (t.includes('friendly'))                               return 20;
  if (t.includes('olympic') || /\bu-\d/.test(t) ||
      t.includes('youth') || t.includes('u20') ||
      t.includes('u17'))                                    return 15;
  // Continental championships (not qualification rounds)
  if (!t.includes('qualif') && (
      t.includes('euro') || t.includes('copa am') ||
      t.includes('africa cup') || t.includes('african cup') ||
      t.includes('asian cup') || t.includes('gold cup') ||
      t.includes('nations cup') || t.includes('confederations')))
                                                            return 35;
  return 30;  // Other competitive: qualifiers, Nations League, etc.
}

/**
 * Goal-difference multiplier.
 *   GD ≤ 1 → ×1.00   GD = 2 → ×1.50
 *   GD = 3 → ×1.75   GD = 4 → ×1.85   GD ≥ 5 → ×1.95 (hard cap ×2.0)
 */
function gdMult(gd) {
  if (gd <= 1) return 1.00;
  if (gd === 2) return 1.50;
  return Math.min(2.00, 1.75 + (gd - 3) * 0.10);
}

// -----------------------------------------------------------------------
// Minimal CSV parser (handles quoted fields)
// -----------------------------------------------------------------------
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (const c of line) {
    if      (c === '"')          { inQ = !inQ; }
    else if (c === ',' && !inQ)  { out.push(cur); cur = ''; }
    else                         { cur += c; }
  }
  out.push(cur);
  return out;
}

// -----------------------------------------------------------------------
// Probability function (mirrors js/elo.js)
// -----------------------------------------------------------------------
const DRAW_BASE   = 0.24;
const DRAW_SIGMA2 = 100_000;

function getProbs(rA, rB) {
  const dr   = rA - rB;
  const eA   = 1 / (1 + Math.pow(10, -dr / 400));
  const raw  = DRAW_BASE * Math.exp(-(dr * dr) / DRAW_SIGMA2);
  const winA = Math.max(0, eA - raw / 2);
  const winB = Math.max(0, (1 - eA) - raw / 2);
  const draw  = Math.max(0, raw);
  const tot  = winA + draw + winB;
  return { winA: winA / tot, draw: draw / tot, winB: winB / tot };
}

const pct = (p) => (p * 100).toFixed(1) + '%';

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------
async function main() {
  const args    = process.argv.slice(2);
  const emitSql = args.includes('--sql');
  const cutoff  = (args.find(a => a.startsWith('--cutoff=')) || `--cutoff=${SEED_CUTOFF}`).split('=')[1];

  process.stderr.write(`Fetching dataset (martj42/international_results)…\n`);
  const res = await fetch(DATASET_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const csv = await res.text();
  const kb  = (csv.length / 1024).toFixed(0);
  process.stderr.write(`Fetched ${kb} KB. Parsing through ${cutoff}…\n`);

  const lines = csv.split('\n');
  const hdr   = lines[0].split(',');
  const COL   = {};
  hdr.forEach((h, i) => { COL[h.trim()] = i; });

  // ratings[canonicalKey] = { rating, games }
  // canonical key = team code for WC2026 teams, raw name for everyone else
  const ratings  = {};
  const unmapped = {};   // unrecognised name → appearance count
  let matched = 0, skipped = 0;

  const getR = (name) => {
    const key = NAME_TO_CODE[name] || name;
    if (!ratings[key]) ratings[key] = { rating: BASE_RATING, games: 0 };
    return ratings[key];
  };

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;

    const cols = parseCsvLine(raw);
    if (cols.length < 6) { skipped++; continue; }

    const date    = (cols[COL.date]       || '').trim();
    const hName   = (cols[COL.home_team]  || '').trim();
    const aName   = (cols[COL.away_team]  || '').trim();
    const hScoreS = (cols[COL.home_score] || '').trim();
    const aScoreS = (cols[COL.away_score] || '').trim();
    const tourn   = (cols[COL.tournament] || '').trim();
    const neutral = (cols[COL.neutral]    || '').trim().toLowerCase() === 'true';

    // Skip post-cutoff rows (data is chronological so this is also our early-exit)
    if (date > cutoff) continue;
    if (hScoreS === 'NA' || aScoreS === 'NA') { skipped++; continue; }

    const hScore = parseInt(hScoreS);
    const aScore = parseInt(aScoreS);
    if (isNaN(hScore) || isNaN(aScore) || !hName || !aName) { skipped++; continue; }

    // Track names NOT in our mapping (for the unmapped report)
    if (!NAME_TO_CODE[hName]) unmapped[hName] = (unmapped[hName] || 0) + 1;
    if (!NAME_TO_CODE[aName]) unmapped[aName] = (unmapped[aName] || 0) + 1;

    const rH = getR(hName);
    const rA = getR(aName);

    const homeAdv = neutral ? 0 : HOME_ADV;
    const dr      = rH.rating + homeAdv - rA.rating;
    const eH      = 1 / (1 + Math.pow(10, -dr / 400));
    const W       = hScore > aScore ? 1 : hScore === aScore ? 0.5 : 0;
    const K       = kFactor(tourn);
    const M       = gdMult(Math.abs(hScore - aScore));
    const delta   = K * M * (W - eH);

    rH.rating += delta;  rH.games++;
    rA.rating -= delta;  rA.games++;
    matched++;
  }

  process.stderr.write(`Done: ${matched.toLocaleString()} matches processed, ${skipped} skipped.\n`);
  process.stderr.write(`Total teams tracked: ${Object.keys(ratings).length}\n\n`);

  // -----------------------------------------------------------------------
  // Build and sort output table
  // -----------------------------------------------------------------------
  const table = Object.entries(DISPLAY_NAME).map(([code, name]) => {
    const r = ratings[code] || { rating: BASE_RATING, games: 0 };
    return { code, name, rating: Math.round(r.rating * 10) / 10, games: r.games };
  });
  table.sort((a, b) => b.rating - a.rating);

  // -----------------------------------------------------------------------
  // Print: parameters block
  // -----------------------------------------------------------------------
  console.log('\n=== WC2026 Team Elo Ratings — Seeded from Historical Data ===');
  console.log(`Dataset : martj42/international_results, ${matched.toLocaleString()} matches (1872 → ${cutoff})`);
  console.log(`Base    : ${BASE_RATING} | Home advantage: +${HOME_ADV} Elo pts (neutral flag respected)`);
  console.log(`K       : WC = 60 | WC qual = 40 | Continental = 35 | Competitive = 30 | Friendly = 20 | Youth = 15`);
  console.log(`GD mult : ≤1 = ×1.00 | 2 = ×1.50 | 3 = ×1.75 | 4 = ×1.85 | ≥5 = ×1.95`);
  console.log('');

  // -----------------------------------------------------------------------
  // Print: ratings table
  // -----------------------------------------------------------------------
  console.log('Rank  Code  Team                     Rating   Games');
  console.log('----  ----  -----------------------  -------  -----');
  table.forEach((t, i) => {
    const rank  = String(i + 1).padStart(4);
    const code  = t.code.padEnd(4);
    const name  = t.name.padEnd(23);
    const elo   = t.rating.toFixed(1).padStart(7);
    const games = String(t.games).padStart(5);
    console.log(`${rank}  ${code}  ${name}  ${elo}  ${games}`);
  });

  // -----------------------------------------------------------------------
  // Print: unmapped teams (≥5 appearances, excluding the 48 WC teams)
  // -----------------------------------------------------------------------
  const WC_CODES = new Set(Object.keys(DISPLAY_NAME));
  const notable  = Object.entries(unmapped)
    .filter(([name, cnt]) => cnt >= 5 && !WC_CODES.has(NAME_TO_CODE[name]))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 25);

  console.log('\n=== Teams with ≥5 appearances NOT mapped to any WC2026 code ===');
  if (notable.length === 0) {
    console.log('(none — all frequently-appearing nations are covered)');
  } else {
    notable.forEach(([name, cnt]) =>
      console.log(`  ${String(cnt).padStart(5)}×  ${name}`)
    );
  }

  // -----------------------------------------------------------------------
  // Print: worked probability examples
  // -----------------------------------------------------------------------
  const examples = [
    ['FRA', 'NOR', 'France', 'Norway'],
    ['BRA', 'SCO', 'Brazil', 'Scotland'],
  ];

  console.log('\n=== Probability Examples (neutral venue, Elo only) ===');
  for (const [cA, cB, nA, nB] of examples) {
    const tA = table.find(t => t.code === cA);
    const tB = table.find(t => t.code === cB);
    const rA = tA?.rating ?? BASE_RATING;
    const rB = tB?.rating ?? BASE_RATING;
    const p  = getProbs(rA, rB);
    console.log('');
    console.log(`  ${nA} (Elo ${rA.toFixed(0)}) vs ${nB} (Elo ${rB.toFixed(0)})  [Δ${(rA - rB).toFixed(0)}]`);
    console.log(`    ${nA} win: ${pct(p.winA)}   Draw: ${pct(p.draw)}   ${nB} win: ${pct(p.winB)}`);
  }

  // -----------------------------------------------------------------------
  // Optional SQL output (stdout, suitable for redirection)
  // -----------------------------------------------------------------------
  if (emitSql) {
    const ts = new Date().toISOString();
    console.log('\n-- ============================================================');
    console.log('-- Paste into Supabase SQL Editor after applying team_elo migration');
    console.log('-- ============================================================');
    console.log('INSERT INTO team_elo (team_code, rating, games_used, last_updated) VALUES');
    const rows = table.map((t, i) =>
      `  ('${t.code}', ${t.rating.toFixed(2)}, ${t.games}, '${ts}')${i < table.length - 1 ? ',' : ''}`
    );
    rows.forEach(r => console.log(r));
    console.log('ON CONFLICT (team_code) DO UPDATE SET');
    console.log('  rating       = EXCLUDED.rating,');
    console.log('  games_used   = EXCLUDED.games_used,');
    console.log('  last_updated = EXCLUDED.last_updated;');
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
