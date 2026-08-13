// ============================================================
//  WC2026 — Elo Update Edge Function
//
//  Applies Elo rating deltas to team_elo when WC2026 matches
//  go FINISHED in match_results.
//
//  Completely decoupled from scoring:
//    - READS  match_results (match_id, home_score, away_score, status)
//    - WRITES team_elo (rating, games_used, last_updated)
//    - WRITES elo_processed_matches (idempotency log)
//    - NEVER  touches scores, predictions, or any other table
//
//  Idempotency: every match_id processed is recorded in
//  elo_processed_matches. Re-running never double-counts.
//
//  Coverage: group stage (matches 1–72, teams known from fixture list).
//  Knockout matches (73–104) are skipped until team codes are available
//  in match_results (future: add home_team/away_team columns there).
//
//  Auth: service_role JWT required (same as auto-update).
// ============================================================

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// -----------------------------------------------------------------------
// Group stage fixtures: [match_id, homeCode, awayCode]
// -----------------------------------------------------------------------
const GROUP_FIXTURES: [number, string, string][] = [
  [1,"MEX","RSA"],[2,"KOR","CZE"],[3,"CAN","BIH"],[4,"USA","PAR"],
  [5,"HAI","SCO"],[6,"AUS","TUR"],[7,"BRA","MAR"],[8,"QAT","SUI"],
  [9,"CIV","ECU"],[10,"GER","CUW"],[11,"NED","JPN"],[12,"SWE","TUN"],
  [13,"KSA","URU"],[14,"ESP","CPV"],[15,"IRN","NZL"],[16,"BEL","EGY"],
  [17,"FRA","SEN"],[18,"IRQ","NOR"],[19,"ARG","ALG"],[20,"AUT","JOR"],
  [21,"GHA","PAN"],[22,"ENG","CRO"],[23,"POR","COD"],[24,"UZB","COL"],
  [25,"CZE","RSA"],[26,"SUI","BIH"],[27,"CAN","QAT"],[28,"MEX","KOR"],
  [29,"BRA","HAI"],[30,"SCO","MAR"],[31,"TUR","PAR"],[32,"USA","AUS"],
  [33,"GER","CIV"],[34,"ECU","CUW"],[35,"NED","SWE"],[36,"TUN","JPN"],
  [37,"URU","CPV"],[38,"ESP","KSA"],[39,"BEL","IRN"],[40,"NZL","EGY"],
  [41,"NOR","SEN"],[42,"FRA","IRQ"],[43,"ARG","AUT"],[44,"JOR","ALG"],
  [45,"ENG","GHA"],[46,"PAN","CRO"],[47,"POR","UZB"],[48,"COL","COD"],
  [49,"SCO","BRA"],[50,"MAR","HAI"],[51,"SUI","CAN"],[52,"BIH","QAT"],
  [53,"CZE","MEX"],[54,"RSA","KOR"],[55,"CUW","CIV"],[56,"ECU","GER"],
  [57,"JPN","SWE"],[58,"TUN","NED"],[59,"TUR","USA"],[60,"PAR","AUS"],
  [61,"NOR","FRA"],[62,"SEN","IRQ"],[63,"EGY","IRN"],[64,"NZL","BEL"],
  [65,"CPV","KSA"],[66,"URU","ESP"],[67,"PAN","ENG"],[68,"CRO","GHA"],
  [69,"ALG","AUT"],[70,"JOR","ARG"],[71,"COL","POR"],[72,"COD","UZB"],
];

// Build match_id → [homeCode, awayCode] lookup
const MATCH_TEAMS = new Map<number, [string, string]>(
  GROUP_FIXTURES.map(([id, h, a]) => [id, [h, a]])
);

// -----------------------------------------------------------------------
// Elo algorithm constants (mirror scripts/seed-elo.js)
// -----------------------------------------------------------------------
const HOME_ADV    = 100;    // WC matches are played at neutral venues in the US/CAN/MEX
const BASE_RATING = 1500;
const WC_K        = 60;     // K factor for World Cup matches

/** Goal-difference multiplier: GD≤1=1.0, GD2=1.5, GD3=1.75, GD5+=1.95 */
function gdMult(gd: number): number {
  if (gd <= 1) return 1.00;
  if (gd === 2) return 1.50;
  return Math.min(2.00, 1.75 + (gd - 3) * 0.10);
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

  // 1. Load current team_elo ratings
  const { data: eloRows, error: eloErr } = await sb
    .from("team_elo")
    .select("team_code, rating, games_used");
  if (eloErr) throw eloErr;

  const ratings: Record<string, { rating: number; games: number }> = {};
  for (const row of (eloRows ?? [])) {
    ratings[row.team_code] = { rating: Number(row.rating), games: row.games_used };
  }
  // Ensure every WC team has a baseline entry
  for (const [, h, a] of GROUP_FIXTURES) {
    for (const code of [h, a]) {
      if (!ratings[code]) ratings[code] = { rating: BASE_RATING, games: 0 };
    }
  }

  // 2. Load already-processed match_ids (idempotency)
  const { data: processed } = await sb
    .from("elo_processed_matches")
    .select("match_id");
  const processedIds = new Set<number>((processed ?? []).map((r: any) => r.match_id));

  // 3. Load finished group stage results not yet processed
  const groupIds = GROUP_FIXTURES.map(([id]) => id);
  const { data: results, error: resErr } = await sb
    .from("match_results")
    .select("match_id, home_score, away_score, status")
    .in("match_id", groupIds)
    .eq("status", "FINISHED");
  if (resErr) throw resErr;

  const newMatches = (results ?? []).filter((r: any) => !processedIds.has(r.match_id));

  // 4. Apply Elo deltas for each new match
  const eloUpserts: any[]     = [];
  const processedInserts: any[] = [];

  for (const match of newMatches) {
    const teams = MATCH_TEAMS.get(match.match_id);
    if (!teams) continue;  // shouldn't happen for group stage

    const [hCode, aCode] = teams;
    const rH = ratings[hCode] ?? { rating: BASE_RATING, games: 0 };
    const rA = ratings[aCode] ?? { rating: BASE_RATING, games: 0 };

    // All WC2026 matches are at neutral venues (US/CAN/MEX — no single "home" advantage)
    const dr   = rH.rating - rA.rating;    // no home advantage at WC
    const eH   = 1 / (1 + Math.pow(10, -dr / 400));
    const hg   = match.home_score as number;
    const ag   = match.away_score as number;
    const W    = hg > ag ? 1 : hg === ag ? 0.5 : 0;
    const M    = gdMult(Math.abs(hg - ag));
    const delta = WC_K * M * (W - eH);

    ratings[hCode].rating += delta;
    ratings[hCode].games++;
    ratings[aCode].rating -= delta;
    ratings[aCode].games++;

    processedInserts.push({
      match_id:   match.match_id,
      home_team:  hCode,
      away_team:  aCode,
      home_score: hg,
      away_score: ag,
      home_delta: Math.round(delta * 100) / 100,
      away_delta: Math.round(-delta * 100) / 100,
    });
  }

  // 5. Upsert changed ratings
  const changedCodes = new Set(processedInserts.flatMap(p => [p.home_team, p.away_team]));
  for (const code of changedCodes) {
    const r = ratings[code];
    eloUpserts.push({
      team_code:    code,
      rating:       Math.round(r.rating * 100) / 100,
      games_used:   r.games,
      last_updated: new Date().toISOString(),
    });
  }

  let updatedTeams = 0, processedCount = 0;

  if (eloUpserts.length > 0) {
    const { error: upErr } = await sb
      .from("team_elo")
      .upsert(eloUpserts, { onConflict: "team_code" });
    if (upErr) throw upErr;
    updatedTeams = eloUpserts.length;
  }

  if (processedInserts.length > 0) {
    const { error: insErr } = await sb
      .from("elo_processed_matches")
      .insert(processedInserts);
    if (insErr) throw insErr;
    processedCount = processedInserts.length;
  }

  const durationMs = Date.now() - startMs;
  console.log(`[elo-update] ${processedCount} new matches processed, ${updatedTeams} team ratings updated (${durationMs}ms)`);

  return new Response(
    JSON.stringify({
      success:          true,
      matches_processed: processedCount,
      teams_updated:    updatedTeams,
      duration_ms:      durationMs,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
