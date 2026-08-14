// ============================================================
//  WC2026 — Supabase Edge Function: auto-update
//
//  Called every 10 minutes by pg_cron via pg_net.
//  1. Check kill-switch (settings.auto_update_enabled)
//  2. Fetch latest results from football-data.org
//  3. Recalculate all player scores (4-4 default for no-prediction)
//  4. Log run to automation_logs
//
//  Auth: requires Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//  (pg_cron supplies this; admins can also call manually for testing)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---- Scoring constants (mirror scoring.js) ----
const EXACT_PTS:  Record<string, number> = { round3:7, round4:7, round5:7, round6:7, round7:7, round8:10 };
const RESULT_PTS: Record<string, number> = { round3:5, round4:5, round5:5, round6:5, round7:5, round8:7  };

// ---- Elo constants (mirror elo-update/index.ts) ----
const WC_K     = 60;
const ELO_BASE = 1500;

function eloGdMult(gd: number): number {
  if (gd <= 1) return 1.00;
  if (gd === 2) return 1.50;
  return Math.min(2.00, 1.75 + (gd - 3) * 0.10);
}

// ---- Group fixture map (mirrors fetch-results/data.js) ----
const GROUP_FIXTURES: [number, string, string, string][] = [
  [1,"A","MEX","RSA"],[2,"A","KOR","CZE"],[3,"B","CAN","BIH"],[4,"D","USA","PAR"],
  [5,"C","HAI","SCO"],[6,"D","AUS","TUR"],[7,"C","BRA","MAR"],[8,"B","QAT","SUI"],
  [9,"E","CIV","ECU"],[10,"E","GER","CUW"],[11,"F","NED","JPN"],[12,"F","SWE","TUN"],
  [13,"H","KSA","URU"],[14,"H","ESP","CPV"],[15,"G","IRN","NZL"],[16,"G","BEL","EGY"],
  [17,"I","FRA","SEN"],[18,"I","IRQ","NOR"],[19,"J","ARG","ALG"],[20,"J","AUT","JOR"],
  [21,"L","GHA","PAN"],[22,"L","ENG","CRO"],[23,"K","POR","COD"],[24,"K","UZB","COL"],
  [25,"A","CZE","RSA"],[26,"B","SUI","BIH"],[27,"B","CAN","QAT"],[28,"A","MEX","KOR"],
  [29,"C","BRA","HAI"],[30,"C","SCO","MAR"],[31,"D","TUR","PAR"],[32,"D","USA","AUS"],
  [33,"E","GER","CIV"],[34,"E","ECU","CUW"],[35,"F","NED","SWE"],[36,"F","TUN","JPN"],
  [37,"H","URU","CPV"],[38,"H","ESP","KSA"],[39,"G","BEL","IRN"],[40,"G","NZL","EGY"],
  [41,"I","NOR","SEN"],[42,"I","FRA","IRQ"],[43,"J","ARG","AUT"],[44,"J","JOR","ALG"],
  [45,"L","ENG","GHA"],[46,"L","PAN","CRO"],[47,"K","POR","UZB"],[48,"K","COL","COD"],
  [49,"C","SCO","BRA"],[50,"C","MAR","HAI"],[51,"B","SUI","CAN"],[52,"B","BIH","QAT"],
  [53,"A","CZE","MEX"],[54,"A","RSA","KOR"],[55,"E","CUW","CIV"],[56,"E","ECU","GER"],
  [57,"F","JPN","SWE"],[58,"F","TUN","NED"],[59,"D","TUR","USA"],[60,"D","PAR","AUS"],
  [61,"I","NOR","FRA"],[62,"I","SEN","IRQ"],[63,"G","EGY","IRN"],[64,"G","NZL","BEL"],
  [65,"H","CPV","KSA"],[66,"H","URU","ESP"],[67,"L","PAN","ENG"],[68,"L","CRO","GHA"],
  [69,"J","ALG","AUT"],[70,"J","JOR","ARG"],[71,"K","COL","POR"],[72,"K","COD","UZB"],
];

const KNOCKOUT_IDS: Record<string, number[]> = {
  ROUND_OF_32:    [73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88],
  ROUND_OF_16:    [89,90,91,92,93,94,95,96],
  QUARTER_FINALS: [97,98,99,100],
  SEMI_FINALS:    [101,102],
  THIRD_PLACE:    [103],
  FINAL:          [104],
};

// match_id → [homeCode, awayCode] for Elo updates (derived from GROUP_FIXTURES)
const ELO_MATCH_TEAMS = new Map<number, [string, string]>(
  GROUP_FIXTURES.map(([id, , h, a]) => [id, [h, a]])
);

// Hardcoded match→round map so uncontested matches still get 4-4 default
const MATCH_ROUND_MAP: Record<number, string> = {};
for (const [id] of GROUP_FIXTURES) MATCH_ROUND_MAP[id] = "round3";
for (const id of KNOCKOUT_IDS.ROUND_OF_32)    MATCH_ROUND_MAP[id] = "round4";
for (const id of KNOCKOUT_IDS.ROUND_OF_16)    MATCH_ROUND_MAP[id] = "round5";
for (const id of KNOCKOUT_IDS.QUARTER_FINALS) MATCH_ROUND_MAP[id] = "round6";
for (const id of KNOCKOUT_IDS.SEMI_FINALS)    MATCH_ROUND_MAP[id] = "round7";
MATCH_ROUND_MAP[103] = "round8";
MATCH_ROUND_MAP[104] = "round8";

const TLA_ALIAS: Record<string, string> = { CUR: "CUW", URY: "URU" };
const norm = (tla: string | null | undefined): string | null => {
  if (!tla) return null;
  const u = tla.toUpperCase();
  return TLA_ALIAS[u] ?? u;
};

// ---- Write a log row ----
async function writeLog(sb: any, entry: {
  status: string;
  results_updated?: number;
  players_rescored?: number;
  default_fills?: number;
  error_message?: string;
  duration_ms?: number;
  triggered_by?: string;
}) {
  try {
    await sb.from("automation_logs").insert({
      status:          entry.status,
      results_updated: entry.results_updated ?? 0,
      players_rescored:entry.players_rescored ?? 0,
      default_fills:   entry.default_fills ?? 0,
      error_message:   entry.error_message ?? null,
      duration_ms:     entry.duration_ms ?? 0,
      triggered_by:    entry.triggered_by ?? "cron",
    });
  } catch (e) {
    console.error("[auto-update] failed to write log:", e);
  }
}

// ---- Calibration helpers (mirror js/elo.js + js/match-probs.js) ----

const DRAW_BASE   = 0.24;
const DRAW_SIGMA2 = 100_000;
const CAL_BLEND_ELO   = 0.70;
const CAL_BLEND_CROWD = 0.30;
const CAL_MIN_CROWD   = 10;

// Form layer: last FORM_WINDOW matches, decay λ=FORM_DECAY per match back, raw W/D/L (no Elo).
// Virtual Elo offset: vRating = 1500 ± (F − 0.5) × FORM_SCALE, then eloThreeWay(vH, vA).
const FORM_WINDOW = 7;
const FORM_DECAY  = 0.75;
const FORM_SCALE  = 200;

interface FormEntry { id: number; home: string; away: string; hg: number; ag: number; }

function eloThreeWay(homeR: number, awayR: number): { home: number; draw: number; away: number } {
  const dr     = homeR - awayR;
  const eA     = 1 / (1 + Math.pow(10, -dr / 400));
  const rawD   = DRAW_BASE * Math.exp(-(dr * dr) / DRAW_SIGMA2);
  const wA     = Math.max(0, eA - rawD / 2);
  const wB     = Math.max(0, (1 - eA) - rawD / 2);
  const wD     = Math.max(0, rawD);
  const tot    = wA + wD + wB;
  return { home: wA / tot, draw: wD / tot, away: wB / tot };
}

function getFormScore(team: string, beforeId: number, history: FormEntry[]): number {
  const past = history.filter(m => m.id < beforeId && (m.home === team || m.away === team));
  const win  = past.slice(-FORM_WINDOW);
  if (!win.length) return 0.5;
  let wSum = 0, wTot = 0;
  for (let i = 0; i < win.length; i++) {
    const k = win.length - 1 - i;
    const w = Math.pow(FORM_DECAY, k);
    const m = win[i];
    const pts = (m.home === team ? m.hg > m.ag : m.ag > m.hg) ? 1.0
              : m.hg === m.ag ? 0.5 : 0.0;
    wSum += w * pts; wTot += w;
  }
  return wTot > 0 ? wSum / wTot : 0.5;
}

function computeFormProbs(fH: number, fA: number): { home: number; draw: number; away: number } {
  // Map form score [0,1] → virtual rating → eloThreeWay (no Elo ratings used here)
  const vH = ELO_BASE + (fH - 0.5) * FORM_SCALE;
  const vA = ELO_BASE + (fA - 0.5) * FORM_SCALE;
  return eloThreeWay(vH, vA);
}

function blendCalib(
  elo: { home: number; draw: number; away: number },
  crowd: { home: number; draw: number; away: number } | null,
  n: number,
): { home: number; draw: number; away: number; eloW: number } {
  if (!crowd || n === 0) return { ...elo, eloW: 1.0 };
  const eW  = n < CAL_MIN_CROWD ? CAL_BLEND_ELO + CAL_BLEND_CROWD * 0.5 : CAL_BLEND_ELO;
  const cW  = n < CAL_MIN_CROWD ? CAL_BLEND_CROWD * 0.5 : CAL_BLEND_CROWD;
  const tw  = eW + cW;
  return {
    home: (elo.home * eW + crowd.home * cW) / tw,
    draw: (elo.draw * eW + crowd.draw * cW) / tw,
    away: (elo.away * eW + crowd.away * cW) / tw,
    eloW: eW / tw,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startMs = Date.now();

  // ---- Auth: require service_role JWT (gateway validates signature; we check the role claim) ----
  let isServiceRole = false;
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
    const payload = JSON.parse(atob(jwt.split(".")[1]));
    isServiceRole = payload.role === "service_role";
  } catch { /* malformed JWT */ }
  if (!isServiceRole) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  // ---- Kill-switch check ----
  try {
    const { data: setting } = await supabaseAdmin
      .from("settings")
      .select("value")
      .eq("key", "auto_update_enabled")
      .single();

    if (setting?.value === "false") {
      await writeLog(supabaseAdmin, { status: "skipped_disabled", duration_ms: Date.now() - startMs });
      return new Response(
        JSON.stringify({ skipped: true, reason: "auto_update_enabled is false" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (e: any) {
    console.error("[auto-update] kill-switch check failed:", e.message);
    // Fail open — if we can't read the setting, proceed
  }

  // ---- Step 1: Fetch results from football-data.org ----
  let resultsUpdated = 0;
  let fetchError: string | null = null;

  try {
    const apiKey = Deno.env.get("FOOTBALL_API_KEY");
    if (!apiKey) throw new Error("FOOTBALL_API_KEY secret not set");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let apiRes: Response;
    try {
      apiRes = await fetch(
        "https://api.football-data.org/v4/competitions/2000/matches",
        { headers: { "X-Auth-Token": apiKey }, signal: controller.signal }
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!apiRes.ok) {
      const text = await apiRes.text();
      throw new Error(`football-data.org ${apiRes.status}: ${text.slice(0, 200)}`);
    }

    const body = await apiRes.json();
    const apiMatches: any[] = body.matches ?? [];

    const groupLookup = new Map<string, number>();
    for (const [id, group, home, away] of GROUP_FIXTURES) {
      groupLookup.set(`${group}:${home}:${away}`, id);
      groupLookup.set(`${group}:${away}:${home}`, id);
    }

    // Knockout team lookup: prefer team codes over positional alignment.
    const koTeamLookup = new Map<string, number>();
    {
      const { data: koRows } = await supabaseAdmin
        .from("match_results")
        .select("match_id, home_team, away_team")
        .gte("match_id", 73)
        .not("home_team", "is", null);
      for (const km of (koRows ?? [])) {
        const h = norm(km.home_team), a = norm(km.away_team);
        if (h && a) {
          koTeamLookup.set(`${h}:${a}`, km.match_id);
          koTeamLookup.set(`${a}:${h}`, km.match_id);
        }
      }
    }

    const apiByStage = new Map<string, any[]>();
    for (const m of apiMatches) {
      if (!apiByStage.has(m.stage)) apiByStage.set(m.stage, []);
      apiByStage.get(m.stage)!.push(m);
    }
    for (const arr of apiByStage.values()) arr.sort((a, b) => a.id - b.id);

    // Matches where the football-data.org API reports the wrong 90-min score.
    // Typically: match went to ET but API says duration=REGULAR and puts the ET
    // score in fullTime with no regularTime — impossible to detect from API data alone.
    // Add an entry here to lock in the correct 90-min and ET scores permanently.
    const SCORE_OVERRIDES: Record<number, { home: number; away: number; ft_home: number | null; ft_away: number | null }> = {
      82:  { home: 2, away: 2, ft_home: 3, ft_away: 2 }, // BEL v SEN: API reports 3-2 REGULAR; actual was 2-2 at 90 min, 3-2 AET
      104: { home: 0, away: 0, ft_home: 1, ft_away: 0 }, // ESP v ARG Final: API reports score inconsistently; actual was 0-0 at 90 min, 1-0 ESP AET
    };

    const upserts: any[] = [];
    for (const match of apiMatches) {
      const status: string = match.status;
      const isLive     = status === "IN_PLAY" || status === "PAUSED" || status === "LIVE";
      const isFinished = match.score?.fullTime?.home != null;
      if (!isLive && !isFinished) continue; // skip TIMED/SCHEDULED/etc.

      const stage: string = match.stage;
      let ourId: number | null = null;

      if (stage === "GROUP_STAGE") {
        const g = (match.group ?? "").replace("GROUP_", "");
        const h = norm(match.homeTeam?.tla);
        const a = norm(match.awayTeam?.tla);
        if (g && h && a) ourId = groupLookup.get(`${g}:${h}:${a}`) ?? null;
      } else {
        // Any non-group stage: team-code lookup works regardless of API stage name.
        const h = norm(match.homeTeam?.tla);
        const a = norm(match.awayTeam?.tla);
        if (h && a) ourId = koTeamLookup.get(`${h}:${a}`) ?? null;
        // Positional fallback only for known stage names (future rounds, unseeded slots).
        if (ourId == null && KNOCKOUT_IDS[stage]) {
          const bucket = apiByStage.get(stage) ?? [];
          const pos    = bucket.findIndex((m: any) => m.id === match.id);
          const ourIds = KNOCKOUT_IDS[stage];
          if (pos >= 0 && pos < ourIds.length) ourId = ourIds[pos];
        }
      }
      if (ourId == null) continue;

      const reg      = match.score?.regularTime;
      const ft       = match.score?.fullTime;
      const duration = match.score?.duration; // REGULAR | EXTRA_TIME | PENALTY_SHOOTOUT
      const wentToET = duration === 'EXTRA_TIME' || duration === 'PENALTY_SHOOTOUT';

      // regularTime = 90-min score (API provides it for ET/PENS matches).
      // When wentToET but regularTime is null the API didn't give us the 90-min split;
      // fullTime is the EXTRA-TIME score, not the 90-min score — using it here would
      // store the wrong value and mis-score predictions. Detect this case and omit
      // home/away score from the upsert so any manual DB correction is preserved.
      // (PostgREST only updates columns present in the request body on conflict.)
      const reg90Known  = reg?.home != null;
      const ambiguousET = wentToET && !reg90Known && isFinished;
      if (ambiguousET) console.warn(`[auto-update] match ${ourId}: EXTRA_TIME with regularTime=null — skipping 90-min score update, needs manual review`);

      // 90-min score: use regularTime if known; for regular-time matches use fullTime;
      // for live matches fall back to halfTime/0 (display only — not scored until FINISHED).
      const homeScore: number = reg90Known ? reg.home
        : (ft?.home ?? match.score?.halfTime?.home ?? 0);
      const awayScore: number = reg90Known ? reg.away
        : (ft?.away ?? match.score?.halfTime?.away ?? 0);

      // After-ET and penalty scores — display only, not used in scoring
      const ftHome:   number | null = wentToET ? (ft?.home   ?? null) : null;
      const ftAway:   number | null = wentToET ? (ft?.away   ?? null) : null;
      const pensHome: number | null = match.score?.penalties?.home ?? null;
      const pensAway: number | null = match.score?.penalties?.away ?? null;

      // Build upsert row.
      const override = SCORE_OVERRIDES[ourId];
      const upsertRow: Record<string, any> = {
        match_id:   ourId,
        ft_home:    override ? override.ft_home : ftHome,
        ft_away:    override ? override.ft_away : ftAway,
        pens_home:  pensHome,
        pens_away:  pensAway,
        status,
        updated_at: new Date().toISOString(),
      };
      if (override) {
        // Hard override: API score is wrong for this match.
        upsertRow.home_score = override.home;
        upsertRow.away_score = override.away;
      } else if (!ambiguousET) {
        upsertRow.home_score = homeScore;
        upsertRow.away_score = awayScore;
      }
      upserts.push(upsertRow);
    }

    if (upserts.length > 0) {
      const { error } = await supabaseAdmin
        .from("match_results")
        .upsert(upserts, { onConflict: "match_id" });
      if (error) throw error;
    }
    resultsUpdated = upserts.length;
    console.log(`[auto-update] fetch: ${resultsUpdated} results upserted`);
  } catch (e: any) {
    fetchError = e.message;
    console.error("[auto-update] fetch error:", fetchError);
    await writeLog(supabaseAdmin, {
      status: "error",
      error_message: `fetch-results: ${fetchError}`,
      duration_ms: Date.now() - startMs,
    });
    return new Response(JSON.stringify({ error: fetchError }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ---- Step 2: Recalculate scores ----
  let playersRescored = 0;
  let defaultFills = 0;

  try {
    const PAGE_SIZE = 1000;

    const { data: matchResults } = await supabaseAdmin
      .from("match_results").select("*").limit(200);
    const resultMap: Record<number, any> = {};
    (matchResults || []).forEach((r: any) => { resultMap[r.match_id] = r; });

    const allPredictions: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page, error: pageErr } = await supabaseAdmin
        .from("predictions").select("*").range(from, from + PAGE_SIZE - 1);
      if (pageErr) throw pageErr;
      if (!page || page.length === 0) break;
      allPredictions.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    const userPreds: Record<string, Record<string, Record<number, any>>> = {};
    const userR2Preds: Record<string, Record<string, string>> = {};
    const userR1Preds: Record<string, Record<string, any>> = {};
    for (const p of allPredictions) {
      if (p.question_key.startsWith("2.")) {
        let val: string | null = null;
        try { val = JSON.parse(p.value); } catch { val = p.value; }
        if (!val) continue;
        const subKey = p.question_key.slice(2); // "w.A", "r.A", etc.
        if (!userR2Preds[p.user_id]) userR2Preds[p.user_id] = {};
        userR2Preds[p.user_id][subKey] = val;
        continue;
      }
      if (p.question_key.startsWith("1.")) {
        let val: any = null;
        try { val = JSON.parse(p.value); } catch { val = p.value; }
        if (val == null) continue;
        if (!userR1Preds[p.user_id]) userR1Preds[p.user_id] = {};
        userR1Preds[p.user_id][p.question_key] = val;
        continue;
      }
      if (!p.question_key.startsWith("m")) continue;
      const matchId = parseInt(p.question_key.slice(1));
      if (isNaN(matchId)) continue;
      if (!userPreds[p.user_id]) userPreds[p.user_id] = {};
      if (!userPreds[p.user_id][p.round]) userPreds[p.user_id][p.round] = {};
      userPreds[p.user_id][p.round][matchId] = p;
    }

    const allProfiles: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page, error: pageErr } = await supabaseAdmin
        .from("profiles").select("id").range(from, from + PAGE_SIZE - 1);
      if (pageErr) throw pageErr;
      if (!page || page.length === 0) break;
      allProfiles.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    const allUserIds = new Set<string>([
      ...Object.keys(userPreds),
      ...allProfiles.map((p: any) => p.id),
    ]);

    // Pre-index matches-with-results by round (uses hardcoded map — no blind spots)
    const matchesByRound: Record<string, number[]> = {};
    for (const [matchIdStr, result] of Object.entries(resultMap)) {
      const matchId = parseInt(matchIdStr);
      const round = MATCH_ROUND_MAP[matchId];
      if (!round) continue;
      if (result.home_score === null || result.away_score === null) continue;
      if (result.status !== 'FINISHED') continue; // only score completed matches
      if (!matchesByRound[round]) matchesByRound[round] = [];
      matchesByRound[round].push(matchId);
    }

    // Derive Round 2 group standings from finished matches
    const GROUPS = ["A","B","C","D","E","F","G","H","I","J","K","L"];
    const groupStandings: Record<string, { winner: string; runnerUp: string } | null> = {};
    for (const group of GROUPS) {
      const gFixtures = GROUP_FIXTURES.filter(([,g]) => g === group);
      const allFinished = gFixtures.every(([id]) => resultMap[id]?.status === 'FINISHED');
      if (!allFinished) { groupStandings[group] = null; continue; }
      const teams: Record<string, { pts: number; gd: number; gf: number }> = {};
      for (const [id, , home, away] of gFixtures) {
        const r = resultMap[id];
        if (!teams[home]) teams[home] = { pts: 0, gd: 0, gf: 0 };
        if (!teams[away]) teams[away] = { pts: 0, gd: 0, gf: 0 };
        const hg = r.home_score, ag = r.away_score;
        teams[home].gf += hg; teams[home].gd += (hg - ag);
        teams[away].gf += ag; teams[away].gd += (ag - hg);
        if (hg > ag) { teams[home].pts += 3; }
        else if (hg === ag) { teams[home].pts += 1; teams[away].pts += 1; }
        else { teams[away].pts += 3; }
      }
      const sorted = Object.entries(teams).sort(([,a], [,b]) =>
        b.pts - a.pts || b.gd - a.gd || b.gf - a.gf
      );
      groupStandings[group] = { winner: sorted[0][0], runnerUp: sorted[1][0] };
    }
    const allGroupsComplete = GROUPS.every(g => groupStandings[g] !== null);

    // ---- Round 1 dynamic answers (mirrors admin.html asComputeAnswers) ----
    // Winner priority: penalty shootout > after-ET score > 90-min score
    function r1KoWinner(r: any): string | null {
      if (!r || r.status !== 'FINISHED') return null;
      if (r.pens_home != null) return r.pens_home > r.pens_away ? r.home_team : r.away_team;
      if (r.ft_home != null) return r.ft_home > r.ft_away ? r.home_team : r.away_team;
      if (r.home_score != null && r.away_score != null && r.home_score !== r.away_score)
        return r.home_score > r.away_score ? r.home_team : r.away_team;
      return null;
    }

    const r1Answers: Record<string, any> = {};

    // Q1.8/1.9/1.11/1.12: only once all 72 group matches are finished
    const finishedGroupCount = GROUP_FIXTURES.filter(([id]) => resultMap[id]?.status === 'FINISHED').length;
    if (finishedGroupCount === 72) {
      const hostsSet = new Set(["USA", "CAN", "MEX"]);
      const watched = ["ENG", "FRA", "BRA", "ARG"];
      let totalGoals = 0, hostGoals = 0;
      const nGoals: Record<string, number> = { ENG: 0, FRA: 0, BRA: 0, ARG: 0 };
      for (const [id, , hc, ac] of GROUP_FIXTURES) {
        const r = resultMap[id];
        totalGoals += r.home_score + r.away_score;
        if (hostsSet.has(hc)) hostGoals += r.home_score;
        if (hostsSet.has(ac)) hostGoals += r.away_score;
        if (nGoals[hc] !== undefined) nGoals[hc] += r.home_score;
        if (nGoals[ac] !== undefined) nGoals[ac] += r.away_score;
      }
      r1Answers['1.8'] = hostGoals;
      r1Answers['1.11'] = totalGoals;
      r1Answers['1.9'] = watched.reduce((best, c) => (nGoals[c] > nGoals[best] ? c : best));

      // Q1.12: hardest group by smallest 1st-4th points gap; tiebreak: higher 4th-place GD
      let hg: string | null = null, minGap = Infinity, prevFourthGd = -Infinity;
      for (const group of GROUPS) {
        const st = groupStandings[group];
        if (!st) continue;
        // Rebuild full 4-team table (groupStandings only stores winner/runnerUp) for the GD tiebreak
        const gFixtures = GROUP_FIXTURES.filter(([, g]) => g === group);
        const teams: Record<string, { pts: number; gd: number }> = {};
        for (const [id, , home, away] of gFixtures) {
          const r = resultMap[id];
          if (!teams[home]) teams[home] = { pts: 0, gd: 0 };
          if (!teams[away]) teams[away] = { pts: 0, gd: 0 };
          const hgScore = r.home_score, agScore = r.away_score;
          teams[home].gd += (hgScore - agScore);
          teams[away].gd += (agScore - hgScore);
          if (hgScore > agScore) teams[home].pts += 3;
          else if (hgScore === agScore) { teams[home].pts += 1; teams[away].pts += 1; }
          else teams[away].pts += 3;
        }
        const sorted = Object.entries(teams).sort(([, a], [, b]) => b.pts - a.pts || b.gd - a.gd);
        if (sorted.length < 4) continue;
        const gap = sorted[0][1].pts - sorted[3][1].pts;
        const fourthGd = sorted[3][1].gd;
        if (gap < minGap || (gap === minGap && fourthGd > prevFourthGd)) {
          minGap = gap; hg = group; prevFourthGd = fourthGd;
        }
      }
      if (hg) r1Answers['1.12'] = hg;
    }

    // Q1.1/Q1.2 from Final (104); Q1.3 + _finalists from semis (101,102)
    const sf101 = resultMap[101], sf102 = resultMap[102];
    if (sf101?.status === 'FINISHED' && sf102?.status === 'FINISHED') {
      const finalHome = r1KoWinner(sf101);
      const finalAway = r1KoWinner(sf102);
      if (finalHome && finalAway) {
        r1Answers['_finalists'] = [finalHome, finalAway];
        const finalR = resultMap[104];
        if (finalR?.status === 'FINISHED') {
          const winner = r1KoWinner(finalR);
          if (winner) {
            r1Answers['1.1'] = winner;
            r1Answers['1.2'] = winner === finalHome ? finalAway : finalHome;
          }
        }
      }
      const beaten: string[] = [];
      for (const sr of [sf101, sf102]) {
        const winner = r1KoWinner(sr);
        if (winner) {
          beaten.push(winner === sr.home_team ? sr.away_team : sr.home_team);
        }
      }
      if (beaten.length === 2) r1Answers['1.3'] = beaten;
    }

    // Admin-entered answers (name/number fields the API can never resolve) — settings table
    const { data: r1SettingsRow } = await supabaseAdmin
      .from("settings").select("value").eq("key", "round1_admin_answers").single();
    let r1AdminAnswers: Record<string, any> = {};
    try { r1AdminAnswers = r1SettingsRow?.value ? JSON.parse(r1SettingsRow.value) : {}; } catch { /* ignore */ }
    const r1AllAnswers = { ...r1Answers, ...r1AdminAnswers };

    // Name matching (mirrors admin.html asNormName/asAutoMatch) — no manual override table exists,
    // so this always uses the automatic surname-based match.
    function r1NormName(s: any): string {
      if (!s) return '';
      return String(s).toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[’ʼ'-]/g, ' ')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ').trim();
    }
    function r1AutoMatch(guess: any, answer: any): boolean {
      const g = r1NormName(guess), a = r1NormName(answer);
      if (!g || !a) return false;
      if (g === a) return true;
      const aSur = a.split(' ').pop() ?? '', gSur = g.split(' ').pop() ?? '';
      if (aSur.length >= 3 && (g === aSur || g.includes(aSur))) return true;
      if (gSur.length >= 3 && (a === gSur || a.includes(gSur))) return true;
      return false;
    }

    function scoreRound1(preds: Record<string, any>): number {
      let points = 0;
      const ans = r1AllAnswers;

      if (preds['1.1'] && ans['1.1']) {
        if (preds['1.1'] === ans['1.1']) points += 20;
        else if (preds['1.1'] === ans['1.2']) points += 10;
      }
      if (preds['1.2'] && ans['1.2']) {
        if (preds['1.2'] === ans['1.2']) points += 10;
        else if (preds['1.2'] === ans['1.1']) points += 5;
      }
      if (preds['1.3a'] && ans['1.3']) {
        const correctSemis: string[] = ans['1.3'] || [];
        const finalists: any[] = (ans['1.1'] || ans['1.2']) ? [ans['1.1'], ans['1.2']] : (ans['_finalists'] || []);
        for (const key of ['1.3a', '1.3b']) {
          const pick = preds[key];
          if (!pick) continue;
          if (correctSemis.includes(pick)) points += 10;
          else if (finalists.includes(pick)) points += 5;
        }
      }
      if (preds['1.4'] && ans['1.4'] != null && r1AutoMatch(preds['1.4'], ans['1.4'])) points += 10;
      if (preds['1.5'] != null && ans['1.5'] != null && parseInt(preds['1.5']) === parseInt(ans['1.5'])) points += 10;
      if (preds['1.6'] && ans['1.6'] != null && r1AutoMatch(preds['1.6'], ans['1.6'])) points += 10;
      if (preds['1.7'] != null && ans['1.7'] != null && parseInt(preds['1.7']) === parseInt(ans['1.7'])) points += 10;
      if (preds['1.8'] != null && ans['1.8'] != null) {
        const diff = Math.abs(parseInt(preds['1.8']) - parseInt(ans['1.8']));
        if (diff === 0) points += 5; else if (diff <= 3) points += 3;
      }
      if (preds['1.9'] && ans['1.9'] != null && preds['1.9'] === ans['1.9']) points += 5;
      if (preds['1.10'] != null && ans['1.10'] != null && parseInt(preds['1.10']) === parseInt(ans['1.10'])) points += 5;
      if (preds['1.11'] != null && ans['1.11'] != null) {
        const diff = Math.abs(parseInt(preds['1.11']) - parseInt(ans['1.11']));
        if (diff === 0) points += 10; else if (diff <= 10) points += 5;
      }
      if (preds['1.12'] && ans['1.12'] != null && preds['1.12'] === ans['1.12']) points += 5;

      return points;
    }

    const scoreUpdates: any[] = [];
    for (const userId of allUserIds) {
      const roundPreds = userPreds[userId] || {};
      const scores: Record<string, number> = {
        round1: 0, round2: 0, round3: 0, round4: 0,
        round5: 0, round6: 0, round7: 0, round8: 0,
      };

      for (const round of ["round3","round4","round5","round6","round7","round8"]) {
        const exactP  = EXACT_PTS[round];
        const resultP = RESULT_PTS[round];
        const submittedPreds = roundPreds[round] || {};
        let pts = 0;

        for (const matchId of (matchesByRound[round] || [])) {
          const result = resultMap[matchId];
          const actH = result.home_score, actA = result.away_score;
          let predH: number, predA: number;

          if (submittedPreds[matchId]) {
            let val: any;
            try { val = JSON.parse(submittedPreds[matchId].value); } catch { continue; }
            predH = parseInt(val.home);
            predA = parseInt(val.away);
            if (isNaN(predH) || isNaN(predA)) continue;
          } else {
            predH = 4; predA = 4;
            defaultFills++;
          }

          if (predH === actH && predA === actA) {
            pts += exactP;
          } else if (Math.sign(predH - predA) === Math.sign(actH - actA)) {
            pts += resultP;
          }
        }
        scores[round] = pts;
      }

      scores.round1 = scoreRound1(userR1Preds[userId] || {});

      // Round 2: Group Winners & Runners-Up
      {
        const r2 = userR2Preds[userId] || {};
        let pts = 0, correctWinners = 0, correctQualifiers = 0;
        for (const group of GROUPS) {
          const standing = groupStandings[group];
          if (!standing) continue;
          const { winner, runnerUp } = standing;
          const predW = r2[`w.${group}`] ?? null;
          const predR = r2[`r.${group}`] ?? null;
          if (predW) {
            if (predW === winner) { pts += 10; correctWinners++; correctQualifiers++; }
            else if (predW === runnerUp) { pts += 5; correctQualifiers++; }
          }
          if (predR) {
            if (predR === runnerUp) { pts += 10; correctQualifiers++; }
            else if (predR === winner) { pts += 5; correctQualifiers++; }
          }
        }
        if (allGroupsComplete) {
          if (correctWinners === 12) pts += 10;
          else if (correctWinners >= 10) pts += 5;
          if (correctQualifiers >= 24) pts += 10;
          else if (correctQualifiers >= 20) pts += 5;
        }
        scores.round2 = pts;
      }

      const total = Object.values(scores).reduce((a, b) => a + b, 0);
      scoreUpdates.push({
        user_id:        userId,
        round1_points:  scores.round1,
        round2_points:  scores.round2,
        round3_points:  scores.round3,
        round4_points:  scores.round4,
        round5_points:  scores.round5,
        round6_points:  scores.round6,
        round7_points:  scores.round7,
        round8_points:  scores.round8,
        total_points:   total,
        updated_at:     new Date().toISOString(),
      });
    }

    if (scoreUpdates.length > 0) {
      const { error } = await supabaseAdmin
        .from("scores")
        .upsert(scoreUpdates, { onConflict: "user_id" });
      if (error) throw error;
    }
    playersRescored = scoreUpdates.length;
    console.log(`[auto-update] scores: ${playersRescored} users, ${defaultFills} 4-4 defaults`);
  } catch (e: any) {
    const scoreError = e.message;
    console.error("[auto-update] score error:", scoreError);
    await writeLog(supabaseAdmin, {
      status: "error",
      results_updated: resultsUpdated,
      error_message: `recalculate-scores: ${scoreError}`,
      duration_ms: Date.now() - startMs,
    });
    return new Response(JSON.stringify({ error: scoreError }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ---- Step 3: Update Elo ratings ----
  // Non-fatal: errors are logged but never surface to the caller.
  // Idempotency: elo_processed_matches tracks which match_ids have been applied,
  // so running every 2 minutes never double-counts a match.
  // eloRatings is declared here so Step 4 (calibration) can read the post-update state.
  let eloRatings: Record<string, { rating: number; games: number }> = {};
  let eloMatchesApplied = 0;
  try {
    // Load current ratings
    const { data: eloRows, error: eloLoadErr } = await supabaseAdmin
      .from("team_elo").select("team_code, rating, games_used");
    if (eloLoadErr) throw eloLoadErr;

    for (const row of (eloRows ?? [])) {
      eloRatings[row.team_code] = { rating: Number(row.rating), games: row.games_used };
    }

    // Idempotency: skip any match_id already recorded in elo_processed_matches
    const { data: processed } = await supabaseAdmin
      .from("elo_processed_matches").select("match_id");
    const processedIds = new Set<number>((processed ?? []).map((r: any) => r.match_id));

    // Find group stage matches that are FINISHED and not yet applied
    const groupIds = GROUP_FIXTURES.map(([id]) => id);
    const { data: finishedMatches, error: matchErr } = await supabaseAdmin
      .from("match_results")
      .select("match_id, home_score, away_score, status")
      .in("match_id", groupIds)
      .eq("status", "FINISHED");
    if (matchErr) throw matchErr;

    const newMatches = (finishedMatches ?? []).filter((r: any) => !processedIds.has(r.match_id));

    const eloUpserts:        any[] = [];
    const processedInserts:  any[] = [];

    for (const match of newMatches) {
      const teams = ELO_MATCH_TEAMS.get(match.match_id);
      if (!teams) continue;

      const [hCode, aCode] = teams;
      const rH = eloRatings[hCode] ?? { rating: ELO_BASE, games: 0 };
      const rA = eloRatings[aCode] ?? { rating: ELO_BASE, games: 0 };

      // Neutral venue — no home advantage at WC2026 (US/CAN/MEX)
      const dr    = rH.rating - rA.rating;
      const eH    = 1 / (1 + Math.pow(10, -dr / 400));
      const hg    = match.home_score as number;
      const ag    = match.away_score as number;
      const W     = hg > ag ? 1 : hg === ag ? 0.5 : 0;
      const delta = WC_K * eloGdMult(Math.abs(hg - ag)) * (W - eH);

      eloRatings[hCode] = { rating: rH.rating + delta, games: rH.games + 1 };
      eloRatings[aCode] = { rating: rA.rating - delta, games: rA.games + 1 };

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

    if (processedInserts.length > 0) {
      const changedCodes = new Set<string>(
        processedInserts.flatMap((p: any) => [p.home_team, p.away_team])
      );
      const now = new Date().toISOString();
      for (const code of changedCodes) {
        const r = eloRatings[code];
        eloUpserts.push({
          team_code:    code,
          rating:       Math.round(r.rating * 100) / 100,
          games_used:   r.games,
          last_updated: now,
        });
      }

      const { error: eloUpErr } = await supabaseAdmin
        .from("team_elo").upsert(eloUpserts, { onConflict: "team_code" });
      if (eloUpErr) throw eloUpErr;

      const { error: eloInsErr } = await supabaseAdmin
        .from("elo_processed_matches").insert(processedInserts);
      if (eloInsErr) throw eloInsErr;

      eloMatchesApplied = processedInserts.length;
    }

    console.log(`[auto-update] elo: ${eloMatchesApplied} new matches applied`);
  } catch (e: any) {
    // Non-fatal — results and scores are already written; Elo will catch up next run
    console.error("[auto-update] elo update error (non-fatal):", e.message);
  }

  // ---- Step 4: Calibration snapshots ----
  // Non-fatal, idempotent. Covers group stage (1-72) and knockout (73-104).
  // Part A: For each upcoming match with no snapshot yet, store current Elo + crowd
  //         probabilities. KO matches are only snapped once both teams are confirmed.
  // Part B: For each snapped match that just finished, record the actual outcome.
  let calibSnapshotted = 0, calibResolved = 0;
  try {
    const groupIds = GROUP_FIXTURES.map(([id]) => id);
    const koIds = [
      73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,
      89,90,91,92,93,94,95,96,
      97,98,99,100,
      101,102,
      103,104,
    ];
    const allCalIds = [...groupIds, ...koIds];
    const groupIdSet = new Set(groupIds);

    // Load existing calibration state
    const { data: calRows } = await supabaseAdmin
      .from("model_calibration").select("match_id, actual_outcome, crowd_n");
    const calMap = new Map<number, string | null>(
      (calRows ?? []).map((r: any) => [r.match_id, r.actual_outcome ?? null])
    );
    const crowdNMap = new Map<number, number>(
      (calRows ?? []).map((r: any) => [r.match_id, r.crowd_n ?? 0])
    );

    // Load current results — include team codes needed for KO snapshotting
    const { data: allResults } = await supabaseAdmin
      .from("match_results")
      .select("match_id, home_score, away_score, status, home_team, away_team")
      .in("match_id", allCalIds);
    const resMap = new Map<number, any>(
      (allResults ?? []).map((r: any) => [r.match_id, r])
    );

    // Build form history from completed group-stage matches (ids 1-72)
    const formHistory: FormEntry[] = [];
    for (const [fid, , fh, fa] of GROUP_FIXTURES) {
      const r = resMap.get(fid);
      if (r?.home_score != null) formHistory.push({ id: fid, home: fh, away: fa, hg: r.home_score, ag: r.away_score });
    }

    // ---- Part A: snapshot upcoming matches ----
    const unsnapped = allCalIds.filter(id => {
      if (calMap.has(id)) return false;
      const res = resMap.get(id);
      if (res?.status === "FINISHED") return false;
      // Group matches: teams are known statically; snap even if no result row yet
      if (groupIdSet.has(id)) return true;
      // KO matches: only snap once both teams are confirmed in match_results
      return !!(res?.home_team && res?.away_team);
    });

    if (unsnapped.length > 0) {
      // Fetch crowd picks for these matches
      const { data: crowdData } = await supabaseAdmin
        .from("predictions")
        .select("question_key, value")
        .in("question_key", unsnapped.map(id => `m${id}`));

      const crowdByQ: Record<string, any[]> = {};
      for (const p of (crowdData ?? [])) {
        if (!crowdByQ[p.question_key]) crowdByQ[p.question_key] = [];
        crowdByQ[p.question_key].push(p);
      }

      const r5 = (n: number) => Math.round(n * 100000) / 100000;
      const r3 = (n: number) => Math.round(n * 1000) / 1000;
      const nowStr = new Date().toISOString();
      const snapshotRows: any[] = [];

      for (const id of unsnapped) {
        let homeCode: string, awayCode: string;
        if (groupIdSet.has(id)) {
          const teams = ELO_MATCH_TEAMS.get(id);
          if (!teams) continue;
          [homeCode, awayCode] = teams;
        } else {
          const koRes = resMap.get(id)!;
          homeCode = koRes.home_team;
          awayCode = koRes.away_team;
        }

        const homeR = eloRatings[homeCode]?.rating ?? ELO_BASE;
        const awayR = eloRatings[awayCode]?.rating ?? ELO_BASE;
        const elo   = eloThreeWay(homeR, awayR);

        // Compute crowd distribution from picks
        const picks = crowdByQ[`m${id}`] ?? [];
        let hw = 0, d = 0, aw = 0;
        for (const p of picks) {
          let v: any; try { v = JSON.parse(p.value); } catch { continue; }
          const h = parseInt(v.home), a = parseInt(v.away);
          if (isNaN(h) || isNaN(a)) continue;
          if (h > a) hw++; else if (h === a) d++; else aw++;
        }
        const crowdN = hw + d + aw;
        const crowd  = crowdN > 0 ? { home: hw / crowdN, draw: d / crowdN, away: aw / crowdN } : null;
        const blend  = blendCalib(elo, crowd, crowdN);

        // Form layer: recency-weighted W/D/L, last 7 matches, λ=0.75 per match back
        const fH   = getFormScore(homeCode, id, formHistory);
        const fA   = getFormScore(awayCode, id, formHistory);
        const form = computeFormProbs(fH, fA);

        snapshotRows.push({
          match_id:         id,
          elo_home:         r5(elo.home),
          elo_draw:         r5(elo.draw),
          elo_away:         r5(elo.away),
          crowd_home:       crowd ? r5(crowd.home) : null,
          crowd_draw:       crowd ? r5(crowd.draw) : null,
          crowd_away:       crowd ? r5(crowd.away) : null,
          crowd_n:          crowdN,
          blend_home:       r5(blend.home),
          blend_draw:       r5(blend.draw),
          blend_away:       r5(blend.away),
          blend_elo_weight: r3(blend.eloW),
          form_home:        r5(form.home),
          form_draw:        r5(form.draw),
          form_away:        r5(form.away),
          snapshot_at:      nowStr,
        });
      }

      if (snapshotRows.length > 0) {
        const { error: snapErr } = await supabaseAdmin
          .from("model_calibration").insert(snapshotRows);
        if (snapErr) console.error("[auto-update] calibration insert error:", snapErr.message);
        else calibSnapshotted = snapshotRows.length;
      }
    }

    // ---- Part A2: refresh crowd picks for snapshots taken with 0 picks ----
    // Matches that have a calibration row with crowd_n=0 but haven't kicked off
    // yet get their crowd columns updated so the final snapshot reflects real picks.
    let calibCrowdRefreshed = 0;
    const toRefreshCrowd = allCalIds.filter(id => {
      if (!calMap.has(id)) return false;
      if ((crowdNMap.get(id) ?? 0) > 0) return false;
      const res = resMap.get(id);
      const s = res?.status ?? '';
      return !['FINISHED', 'IN_PLAY', 'PAUSED', 'LIVE'].includes(s);
    });

    if (toRefreshCrowd.length > 0) {
      const { data: refreshData } = await supabaseAdmin
        .from("predictions")
        .select("question_key, value")
        .in("question_key", toRefreshCrowd.map(id => `m${id}`));

      const crowdByQR: Record<string, any[]> = {};
      for (const p of (refreshData ?? [])) {
        if (!crowdByQR[p.question_key]) crowdByQR[p.question_key] = [];
        crowdByQR[p.question_key].push(p);
      }

      const r5r = (n: number) => Math.round(n * 100000) / 100000;
      const r3r = (n: number) => Math.round(n * 1000) / 1000;

      for (const id of toRefreshCrowd) {
        const picks = crowdByQR[`m${id}`] ?? [];
        let hw = 0, d = 0, aw = 0;
        for (const p of picks) {
          let v: any; try { v = JSON.parse(p.value); } catch { continue; }
          const h = parseInt(v.home), a = parseInt(v.away);
          if (isNaN(h) || isNaN(a)) continue;
          if (h > a) hw++; else if (h === a) d++; else aw++;
        }
        const crowdN = hw + d + aw;
        if (crowdN === 0) continue;

        const crowd = { home: hw / crowdN, draw: d / crowdN, away: aw / crowdN };

        let homeCode: string, awayCode: string;
        if (groupIdSet.has(id)) {
          const teams = ELO_MATCH_TEAMS.get(id);
          if (!teams) continue;
          [homeCode, awayCode] = teams;
        } else {
          const koRes = resMap.get(id);
          if (!koRes?.home_team) continue;
          homeCode = koRes.home_team;
          awayCode = koRes.away_team;
        }
        const homeR = eloRatings[homeCode]?.rating ?? ELO_BASE;
        const awayR = eloRatings[awayCode]?.rating ?? ELO_BASE;
        const elo   = eloThreeWay(homeR, awayR);
        const blend = blendCalib(elo, crowd, crowdN);

        const { error: refreshErr } = await supabaseAdmin
          .from("model_calibration")
          .update({
            crowd_home:       r5r(crowd.home),
            crowd_draw:       r5r(crowd.draw),
            crowd_away:       r5r(crowd.away),
            crowd_n:          crowdN,
            blend_home:       r5r(blend.home),
            blend_draw:       r5r(blend.draw),
            blend_away:       r5r(blend.away),
            blend_elo_weight: r3r(blend.eloW),
          })
          .eq("match_id", id);
        if (!refreshErr) calibCrowdRefreshed++;
      }
    }

    // ---- Part B: resolve outcomes ----
    const unresolved = allCalIds.filter(id => calMap.has(id) && calMap.get(id) === null);
    for (const id of unresolved) {
      const res = resMap.get(id);
      if (!res || res.status !== "FINISHED" || res.home_score == null) continue;
      const outcome = res.home_score > res.away_score ? "home"
                    : res.home_score === res.away_score ? "draw"
                    : "away";
      const { error: resErr } = await supabaseAdmin
        .from("model_calibration")
        .update({
          actual_outcome: outcome,
          home_score:     res.home_score,
          away_score:     res.away_score,
          resolved_at:    new Date().toISOString(),
        })
        .eq("match_id", id);
      if (!resErr) calibResolved++;
    }

    console.log(`[auto-update] calibration: ${calibSnapshotted} snapped, ${calibCrowdRefreshed} crowd-refreshed, ${calibResolved} resolved`);
  } catch (e: any) {
    console.error("[auto-update] calibration error (non-fatal):", e.message);
  }

  // ---- Step 5: R32 bracket seeding ----
  // Direct matches (W/R sides only) seed per-match as soon as their groups finish.
  // Third-place slots need ALL 12 groups for cross-group ranking — unavoidable.
  let bracketSeeded = 0;
  try {
    const GROUPS_ALL = ["A","B","C","D","E","F","G","H","I","J","K","L"];
    const groupIds = GROUP_FIXTURES.map(([id]) => id);

    const { data: groupResults, error: grpErr } = await supabaseAdmin
      .from("match_results")
      .select("match_id, home_score, away_score, status")
      .in("match_id", groupIds);
    if (grpErr) throw grpErr;

    const grpMap: Record<number, any> = {};
    (groupResults || []).forEach((r: any) => { grpMap[r.match_id] = r; });

    const gStandings: Record<string, { winner: string; runnerUp: string; third: string } | null> = {};
    const allThird: { group: string; code: string; pts: number; gd: number; gf: number }[] = [];

    for (const grp of GROUPS_ALL) {
      const fixtures = GROUP_FIXTURES.filter(([, g]) => g === grp);
      if (!fixtures.every(([id]) => grpMap[id]?.status === 'FINISHED')) {
        gStandings[grp] = null; continue;
      }
      const teams: Record<string, { pts: number; gd: number; gf: number }> = {};
      for (const [id, , hm, aw] of fixtures) {
        const r = grpMap[id];
        if (!teams[hm]) teams[hm] = { pts: 0, gd: 0, gf: 0 };
        if (!teams[aw]) teams[aw] = { pts: 0, gd: 0, gf: 0 };
        const hg = r.home_score as number, ag = r.away_score as number;
        teams[hm].gf += hg; teams[hm].gd += hg - ag;
        teams[aw].gf += ag; teams[aw].gd += ag - hg;
        if (hg > ag) { teams[hm].pts += 3; }
        else if (hg === ag) { teams[hm].pts += 1; teams[aw].pts += 1; }
        else { teams[aw].pts += 3; }
      }
      const srt = Object.entries(teams).sort(([, a], [, b]) =>
        b.pts - a.pts || b.gd - a.gd || b.gf - a.gf
      );
      gStandings[grp] = { winner: srt[0][0], runnerUp: srt[1][0], third: srt[2][0] };
      allThird.push({ group: grp, code: srt[2][0], pts: srt[2][1].pts, gd: srt[2][1].gd, gf: srt[2][1].gf });
    }

    // ---- Direct matches: seed as soon as both dependent groups are complete ----
    type WRSide = ['W'|'R', string];
    const resolveWR = (side: WRSide): string | null => {
      const s = gStandings[side[1]];
      return side[0] === 'W' ? (s?.winner ?? null) : (s?.runnerUp ?? null);
    };
    // [matchId, homeSide, homeDepGroups, awaySide, awayDepGroups]
    const R32_DIRECT: [number, WRSide, string[], WRSide, string[]][] = [
      [73, ['R','A'], ['A'], ['R','B'], ['B']],
      [75, ['W','F'], ['F'], ['R','C'], ['C']],
      [76, ['W','C'], ['C'], ['R','F'], ['F']],
      [78, ['R','E'], ['E'], ['R','I'], ['I']],
      [83, ['R','K'], ['K'], ['R','L'], ['L']],
      [84, ['W','H'], ['H'], ['R','J'], ['J']],
      [86, ['W','J'], ['J'], ['R','H'], ['H']],
      [88, ['R','D'], ['D'], ['R','G'], ['G']],
    ];
    const seedUpserts: any[] = [];
    for (const [id, hSide, hDeps, aSide, aDeps] of R32_DIRECT) {
      if (![...hDeps, ...aDeps].every(g => gStandings[g] !== null)) continue;
      const ht = resolveWR(hSide), at = resolveWR(aSide);
      if (ht && at) seedUpserts.push({ match_id: id, home_team: ht, away_team: at });
    }

    // ---- Third-place slots: need ALL groups (cross-group ranking shifts late results) ----
    const allComplete = GROUPS_ALL.every(g => gStandings[g] !== null);
    if (allComplete) {
      allThird.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
      const qualGroups = allThird.slice(0, 8).map(t => t.group);
      const thirdTeam: Record<string, string> = {};
      allThird.slice(0, 8).forEach(t => { thirdTeam[t.group] = t.code; });

      const THIRD_ELIG: Record<number, Set<string>> = {
        74: new Set(['A','B','C','D','F']),
        77: new Set(['C','D','F','G','H']),
        79: new Set(['C','E','F','H','I']),
        80: new Set(['E','H','I','J','K']),
        81: new Set(['B','E','F','I','J']),
        82: new Set(['A','E','H','I','J']),
        85: new Set(['E','F','G','I','J']),
        87: new Set(['D','E','I','J','L']),
      };
      const slotIds = Object.keys(THIRD_ELIG).map(Number);
      const slotToGroup: Record<number, string> = {};

      const THIRD_PLACE_TABLE: Record<string, Record<number, string>> = {
        'BDEFIJKL': { 74:'D', 77:'F', 79:'E', 80:'K', 81:'B', 82:'I', 85:'J', 87:'L' },
      };
      const qualGroupsSorted = qualGroups.slice().sort().join('');
      if (THIRD_PLACE_TABLE[qualGroupsSorted]) {
        Object.assign(slotToGroup, THIRD_PLACE_TABLE[qualGroupsSorted]);
      } else {
        console.warn(`[auto-update] No FIFA table entry for qualifying set: ${qualGroupsSorted} — falling back to bipartite matching (may differ from official bracket)`);
        const augmentBracket = (grp: string, seen: Set<number>): boolean => {
          for (const slot of slotIds) {
            if (seen.has(slot)) continue;
            if (!THIRD_ELIG[slot].has(grp)) continue;
            seen.add(slot);
            if (!slotToGroup[slot] || augmentBracket(slotToGroup[slot], seen)) {
              slotToGroup[slot] = grp; return true;
            }
          }
          return false;
        };
        const byDegree = [...qualGroups].sort((a, b) =>
          slotIds.filter(s => THIRD_ELIG[s].has(a)).length -
          slotIds.filter(s => THIRD_ELIG[s].has(b)).length
        );
        for (const g of byDegree) augmentBracket(g, new Set());
      }

      // [matchId, homeWinnerGroup, thirdSlotId]
      const R32_THIRD: [number, string, number][] = [
        [74, 'E', 74], [77, 'I', 77], [79, 'A', 79], [80, 'L', 80],
        [81, 'D', 81], [82, 'G', 82], [85, 'B', 85], [87, 'K', 87],
      ];
      for (const [id, winGrp, slot] of R32_THIRD) {
        const ht = gStandings[winGrp]?.winner ?? null;
        const ag = slotToGroup[slot];
        const at = ag ? (thirdTeam[ag] ?? null) : null;
        if (ht && at) seedUpserts.push({ match_id: id, home_team: ht, away_team: at });
      }
    } else {
      const pending = GROUPS_ALL.filter(g => gStandings[g] === null);
      console.log(`[auto-update] bracket: 3rd-place slots await groups ${pending.join(',')}`);
    }

    if (seedUpserts.length > 0) {
      // Never overwrite slots that already have both teams set (preserves manual corrections).
      const allSlotIds = seedUpserts.map((u: any) => u.match_id);
      const { data: existingSeeded } = await supabaseAdmin
        .from("match_results")
        .select("match_id")
        .in("match_id", allSlotIds)
        .not("home_team", "is", null)
        .not("away_team", "is", null);
      const alreadySet = new Set<number>((existingSeeded ?? []).map((r: any) => r.match_id));
      const freshUpserts = seedUpserts.filter((u: any) => !alreadySet.has(u.match_id));

      if (freshUpserts.length > 0) {
        const { error: seedErr } = await supabaseAdmin
          .from("match_results")
          .upsert(freshUpserts, { onConflict: "match_id" });
        if (seedErr) throw seedErr;
        bracketSeeded = freshUpserts.length;
      }
    }
    console.log(`[auto-update] bracket: ${bracketSeeded} R32 matches seeded`);
  } catch (e: any) {
    console.error("[auto-update] bracket seeding error (non-fatal):", e.message);
  }

  // ---- Step 6: Propagate knockout winners into next-round slots ----
  // Winner priority: penalty shootout > after-ET score > 90-min score
  // [targetMatchId, homeSourceMatchId, awaySourceMatchId]
  const KO_FEED_MAP: [number, number, number][] = [
    [89, 74, 77], [90, 73, 75], [91, 76, 78], [92, 79, 80],
    [93, 83, 84], [94, 81, 82], [95, 86, 88], [96, 85, 87],
    [97, 89, 90], [98, 93, 94], [99, 91, 92], [100, 95, 96],
    [101, 97, 98], [102, 99, 100],
    [104, 101, 102],
  ];
  // Third-place playoff (103) feeds from the LOSERS of the semifinals, not the winners
  const KO_LOSER_FEED_MAP: [number, number, number][] = [
    [103, 101, 102],
  ];
  function getKoWinner(r: any): string | null {
    if (!r || r.status !== 'FINISHED') return null;
    if (r.pens_home != null) return r.pens_home > r.pens_away ? r.home_team : r.away_team;
    if (r.ft_home   != null) return r.ft_home  > r.ft_away   ? r.home_team : r.away_team;
    if (r.home_score != null && r.away_score != null && r.home_score !== r.away_score)
      return r.home_score > r.away_score ? r.home_team : r.away_team;
    return null;
  }
  function getKoLoser(r: any): string | null {
    const winner = getKoWinner(r);
    if (!winner) return null;
    return winner === r.home_team ? r.away_team : r.home_team;
  }
  let koWinnersSeeded = 0;
  try {
    const allKoIds = [...Object.values(KNOCKOUT_IDS).flat()];
    const { data: koRows, error: koErr } = await supabaseAdmin
      .from('match_results')
      .select('match_id,home_team,away_team,home_score,away_score,ft_home,ft_away,pens_home,pens_away,status')
      .in('match_id', allKoIds);
    if (koErr) throw koErr;

    const koMap: Record<number, any> = {};
    (koRows ?? []).forEach((r: any) => { koMap[r.match_id] = r; });

    const propUpserts: any[] = [];
    for (const [target, homeSrc, awaySrc] of KO_FEED_MAP) {
      const homeWinner = getKoWinner(koMap[homeSrc]);
      const awayWinner = getKoWinner(koMap[awaySrc]);
      if (!homeWinner && !awayWinner) continue;
      const u: any = { match_id: target, updated_at: new Date().toISOString() };
      if (homeWinner) u.home_team = homeWinner;
      if (awayWinner) u.away_team = awayWinner;
      propUpserts.push(u);
    }
    for (const [target, homeSrc, awaySrc] of KO_LOSER_FEED_MAP) {
      const homeLoser = getKoLoser(koMap[homeSrc]);
      const awayLoser = getKoLoser(koMap[awaySrc]);
      if (!homeLoser && !awayLoser) continue;
      const u: any = { match_id: target, updated_at: new Date().toISOString() };
      if (homeLoser) u.home_team = homeLoser;
      if (awayLoser) u.away_team = awayLoser;
      propUpserts.push(u);
    }

    if (propUpserts.length > 0) {
      const { error: propErr } = await supabaseAdmin
        .from('match_results')
        .upsert(propUpserts, { onConflict: 'match_id' });
      if (propErr) throw propErr;
      koWinnersSeeded = propUpserts.length;
    }
    console.log(`[auto-update] ko-propagate: ${koWinnersSeeded} slots updated`);
  } catch (e: any) {
    console.error("[auto-update] ko-propagate error (non-fatal):", e.message);
  }

  // ---- Log success ----
  const durationMs = Date.now() - startMs;
  await writeLog(supabaseAdmin, {
    status: "success",
    results_updated: resultsUpdated,
    players_rescored: playersRescored,
    default_fills: defaultFills,
    duration_ms: durationMs,
  });

  return new Response(
    JSON.stringify({
      success: true,
      results_updated: resultsUpdated,
      players_rescored: playersRescored,
      default_fills: defaultFills,
      elo_matches_applied: eloMatchesApplied,
      calib_snapshotted: calibSnapshotted,
      calib_resolved: calibResolved,
      bracket_seeded: bracketSeeded,
      ko_winners_seeded: koWinnersSeeded,
      duration_ms: durationMs,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
