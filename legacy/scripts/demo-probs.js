#!/usr/bin/env node
/**
 * scripts/demo-probs.js
 *
 * Prints worked Elo + crowd + blended probability examples for upcoming WC2026 matches.
 * Queries live data from Supabase: team_elo ratings and predictions table.
 *
 * Usage:
 *   node scripts/demo-probs.js
 *
 * Requirements: Node 18+ (built-in fetch). No npm install needed.
 */

const path       = require('path');
const MatchProbs = require(path.join(__dirname, '../js/match-probs.js'));
const { computeCrowdPicks, getMatchProbs, formatProbs, pct, BLEND_WEIGHTS } = MatchProbs;

const SUPABASE_URL  = 'https://juknwgkehoatkbentidw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1a253Z2tlaG9hdGtiZW50aWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NDgxNjMsImV4cCI6MjA5NjIyNDE2M30.D2tK0eqvj8i5uPTnAeVNksn5K6oPwZEr7aiYA-2ljOQ';

// Upcoming matches to demo (final group-stage round, 2026-06-26/27)
const DEMO_MATCHES = [
  { id: 61, home: 'NOR', homeName: 'Norway',   away: 'FRA', awayName: 'France',   group: 'I', kickoff: '2026-06-26 19:00 UTC' },
  { id: 66, home: 'URU', homeName: 'Uruguay',  away: 'ESP', awayName: 'Spain',    group: 'H', kickoff: '2026-06-27 00:00 UTC' },
  { id: 71, home: 'COL', homeName: 'Colombia', away: 'POR', awayName: 'Portugal', group: 'K', kickoff: '2026-06-27 23:30 UTC' },
];

// ---- Minimal Supabase REST helper (no client library) ----
async function sbGet(table, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${table} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ---- Main ----
async function main() {
  // 1. Fetch Elo ratings for all teams we need
  const teamCodes = [...new Set(DEMO_MATCHES.flatMap(m => [m.home, m.away]))];
  const eloRows   = await sbGet('team_elo',
    `select=team_code,rating&team_code=in.(${teamCodes.join(',')})&order=rating.desc`
  );
  const ratings = {};
  for (const r of eloRows) ratings[r.team_code] = Number(r.rating);

  // 2. Fetch predictions for each demo match in parallel
  const rawPredsByMatch = await Promise.all(
    DEMO_MATCHES.map(m => sbGet('predictions', `select=value&question_key=eq.m${m.id}`))
  );

  // 3. Compute and print
  const eloStr   = `${(BLEND_WEIGHTS.elo   * 100).toFixed(0)}%`;
  const crowdStr = `${(BLEND_WEIGHTS.crowd * 100).toFixed(0)}%`;

  process.stdout.write('\n');
  process.stdout.write(`=== WC2026 Prediction Model — Worked Examples ===\n`);
  process.stdout.write(`Blend weights: ${eloStr} Elo / ${crowdStr} Crowd`);
  process.stdout.write(`  (MIN_CROWD_SIZE=${MatchProbs.MIN_CROWD_SIZE} — crowd weight halved below this)\n`);
  process.stdout.write('\n');

  for (let i = 0; i < DEMO_MATCHES.length; i++) {
    const m      = DEMO_MATCHES[i];
    const crowd  = computeCrowdPicks(rawPredsByMatch[i]);
    const homeR  = ratings[m.home] ?? 1500;
    const awayR  = ratings[m.away] ?? 1500;
    const result = getMatchProbs(homeR, awayR, crowd);

    const dElo   = homeR - awayR;
    const dSign  = dElo >= 0 ? '+' : '';
    const pickLabel = crowd ? `${crowd.pickCount} picks` : 'no picks';

    process.stdout.write(`--- Match ${m.id}: ${m.homeName} vs ${m.awayName}  (Group ${m.group}, ${m.kickoff}) ---\n`);
    process.stdout.write(`  Elo ratings:      ${m.homeName} ${homeR.toFixed(0)}  vs  ${m.awayName} ${awayR.toFixed(0)}  [Δ${dSign}${dElo.toFixed(0)}]\n`);
    process.stdout.write('\n');
    process.stdout.write(`  Elo only:         ${formatProbs(result.elo, m.homeName, m.awayName)}\n`);
    if (result.crowd) {
      process.stdout.write(`  Crowd (${pickLabel}): ${formatProbs(result.crowd, m.homeName, m.awayName)}\n`);
    } else {
      process.stdout.write(`  Crowd:            (${pickLabel})\n`);
    }
    process.stdout.write(`  Blended:          ${formatProbs(result.blended, m.homeName, m.awayName)}\n`);
    if (result.weights !== BLEND_WEIGHTS) {
      process.stdout.write(`  (applied weights: ${(result.weights.elo*100).toFixed(0)}% Elo / ${(result.weights.crowd*100).toFixed(0)}% Crowd — dampened for small sample)\n`);
    }
    process.stdout.write('\n');
  }
}

main().catch(e => { process.stderr.write(`FATAL: ${e.message}\n`); process.exit(1); });
