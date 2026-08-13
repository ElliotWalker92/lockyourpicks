// ============================================================
//  WC2026 — Elo Seed Edge Function
//
//  One-time admin-triggered function that:
//    1. Fetches the martj42 "International football results
//       1872–present" CSV dataset from GitHub
//    2. Processes ALL matches up to SEED_CUTOFF (2026-06-10,
//       the day before WC2026 starts)
//    3. Upserts the resulting Elo ratings into team_elo
//
//  Run once from the admin panel or curl to initialise ratings.
//  Safe to re-run: it overwrites team_elo but does NOT touch
//  elo_processed_matches, so subsequent elo-update runs will
//  still apply WC2026 deltas correctly.
//
//  Auth: service_role JWT required.
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DATASET_URL  = "https://raw.githubusercontent.com/martj42/international_results/master/results.csv";
const SEED_CUTOFF  = "2026-06-10";  // inclusive; WC2026 group stage starts 2026-06-11
const HOME_ADV     = 100;
const BASE_RATING  = 1500;

// -----------------------------------------------------------------------
// Dataset name → WC2026 team code
// All strings verified against the actual martj42 CSV.
// -----------------------------------------------------------------------
const NAME_TO_CODE: Record<string, string> = {
  "Mexico":                   "MEX", "Canada":                   "CAN",
  "United States":            "USA", "Haiti":                    "HAI",
  "Panama":                   "PAN", "Curaçao":                  "CUW",
  "Brazil":                   "BRA", "Argentina":                "ARG",
  "Colombia":                 "COL", "Uruguay":                  "URU",
  "Ecuador":                  "ECU", "Paraguay":                 "PAR",
  "England":                  "ENG", "Scotland":                 "SCO",
  "France":                   "FRA", "Germany":                  "GER",
  "Spain":                    "ESP", "Netherlands":              "NED",
  "Belgium":                  "BEL", "Portugal":                 "POR",
  "Croatia":                  "CRO", "Switzerland":              "SUI",
  "Norway":                   "NOR", "Sweden":                   "SWE",
  "Austria":                  "AUT", "Czech Republic":           "CZE",
  "Bosnia and Herzegovina":   "BIH", "South Africa":             "RSA",
  "Morocco":                  "MAR", "Tunisia":                  "TUN",
  "Egypt":                    "EGY", "Senegal":                  "SEN",
  "Ivory Coast":              "CIV", "Ghana":                    "GHA",
  "Algeria":                  "ALG", "DR Congo":                 "COD",
  "Cape Verde":               "CPV", "South Korea":              "KOR",
  "Japan":                    "JPN", "Australia":                "AUS",
  "Iran":                     "IRN", "Saudi Arabia":             "KSA",
  "Qatar":                    "QAT", "Iraq":                     "IRQ",
  "Jordan":                   "JOR", "Uzbekistan":               "UZB",
  "New Zealand":              "NZL", "Turkey":                   "TUR",
};

const WC_CODES = new Set(Object.values(NAME_TO_CODE));

// -----------------------------------------------------------------------
// Elo helpers
// -----------------------------------------------------------------------
function kFactor(tournament: string): number {
  const t = tournament.toLowerCase();
  if (t === "fifa world cup")                               return 60;
  if (t.includes("world cup"))                              return 40;
  if (t.includes("friendly"))                               return 20;
  if (t.includes("olympic") || /\bu-\d/.test(t) ||
      t.includes("youth") || t.includes("u20") || t.includes("u17")) return 15;
  if (!t.includes("qualif") && (
      t.includes("euro") || t.includes("copa am") ||
      t.includes("africa cup") || t.includes("african cup") ||
      t.includes("asian cup") || t.includes("gold cup") ||
      t.includes("nations cup") || t.includes("confederations")))     return 35;
  return 30;
}

function gdMult(gd: number): number {
  if (gd <= 1) return 1.00;
  if (gd === 2) return 1.50;
  return Math.min(2.00, 1.75 + (gd - 3) * 0.10);
}

// -----------------------------------------------------------------------
// Minimal CSV parser
// -----------------------------------------------------------------------
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (const c of line) {
    if      (c === '"')          { inQ = !inQ; }
    else if (c === ',' && !inQ)  { out.push(cur); cur = ""; }
    else                         { cur += c; }
  }
  out.push(cur);
  return out;
}

// -----------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth: service_role JWT only
  try {
    const jwt     = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
    const payload = JSON.parse(atob(jwt.split(".")[1]));
    if (payload.role !== "service_role") throw new Error("not service_role");
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const startMs = Date.now();
  console.log(`[elo-seed] fetching dataset from ${DATASET_URL}…`);

  // 1. Fetch CSV
  let csv: string;
  try {
    const fetchCtl = new AbortController();
    const timeout  = setTimeout(() => fetchCtl.abort(), 30_000);
    const csvRes   = await fetch(DATASET_URL, { signal: fetchCtl.signal });
    clearTimeout(timeout);
    if (!csvRes.ok) throw new Error(`HTTP ${csvRes.status}`);
    csv = await csvRes.text();
  } catch (e: any) {
    return new Response(JSON.stringify({ error: `Dataset fetch failed: ${e.message}` }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log(`[elo-seed] fetched ${(csv.length / 1024).toFixed(0)} KB, parsing through ${SEED_CUTOFF}…`);

  // 2. Parse and compute Elo
  const lines = csv.split("\n");
  const hdr   = lines[0].split(",");
  const COL: Record<string, number> = {};
  hdr.forEach((h, i) => { COL[h.trim()] = i; });

  // canonical key: team code for WC2026 teams, raw name otherwise
  const ratings: Record<string, { rating: number; games: number }> = {};
  const getR = (name: string) => {
    const key = NAME_TO_CODE[name] ?? name;
    if (!ratings[key]) ratings[key] = { rating: BASE_RATING, games: 0 };
    return ratings[key];
  };

  let matched = 0, skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;

    const cols   = parseLine(raw);
    if (cols.length < 6) { skipped++; continue; }

    const date    = (cols[COL.date]       ?? "").trim();
    const hName   = (cols[COL.home_team]  ?? "").trim();
    const aName   = (cols[COL.away_team]  ?? "").trim();
    const hScoreS = (cols[COL.home_score] ?? "").trim();
    const aScoreS = (cols[COL.away_score] ?? "").trim();
    const tourn   = (cols[COL.tournament] ?? "").trim();
    const neutral = (cols[COL.neutral]    ?? "").trim().toLowerCase() === "true";

    if (date > SEED_CUTOFF)  continue;  // post-cutoff; data is ordered so could break but continue is safe
    if (hScoreS === "NA" || aScoreS === "NA") { skipped++; continue; }

    const hScore = parseInt(hScoreS);
    const aScore = parseInt(aScoreS);
    if (isNaN(hScore) || isNaN(aScore) || !hName || !aName) { skipped++; continue; }

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

  console.log(`[elo-seed] processed ${matched} matches (${skipped} skipped)`);

  // 3. Build upserts for the 48 WC2026 teams
  const now    = new Date().toISOString();
  const upserts = [...WC_CODES].map(code => {
    const r = ratings[code] ?? { rating: BASE_RATING, games: 0 };
    return {
      team_code:    code,
      rating:       Math.round(r.rating * 100) / 100,
      games_used:   r.games,
      last_updated: now,
    };
  });

  // 4. Sort for log output (highest rated first)
  upserts.sort((a, b) => b.rating - a.rating);

  console.log("[elo-seed] top 5 teams:");
  upserts.slice(0, 5).forEach(u =>
    console.log(`  ${u.team_code}  ${u.rating.toFixed(1)}  (${u.games_used} games)`)
  );

  // 5. Upsert into team_elo
  const { error: upsertErr } = await sb
    .from("team_elo")
    .upsert(upserts, { onConflict: "team_code" });
  if (upsertErr) throw upsertErr;

  const durationMs = Date.now() - startMs;
  console.log(`[elo-seed] done in ${durationMs}ms`);

  return new Response(
    JSON.stringify({
      success:          true,
      matches_processed: matched,
      teams_seeded:     upserts.length,
      duration_ms:      durationMs,
      ratings:          upserts,   // full table in response for inspection
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
