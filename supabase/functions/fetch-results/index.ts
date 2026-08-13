// ============================================================
//  WC2026 — Supabase Edge Function: fetch-results
//  Deploy:  supabase functions deploy fetch-results
//
//  Calls football-data.org server-side (no browser CORS issue),
//  maps each finished match to our internal match ID (1-104),
//  upserts into match_results via the service role.
//
//  Required Supabase secret (set once):
//    supabase secrets set FOOTBALL_API_KEY=<your_key>
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---- Fixture data (mirrors client-side data.js) ----
// Tuple: [ourMatchId, group, homeCode, awayCode]
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

// Knockout stages: our match IDs in schedule order.
// API and our data both assign IDs sequentially, so sorting by ID gives a
// stable positional alignment between the two datasets.
const KNOCKOUT_IDS: Record<string, number[]> = {
  ROUND_OF_32:    [73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88],
  ROUND_OF_16:    [89,90,91,92,93,94,95,96],
  QUARTER_FINALS: [97,98,99,100],
  SEMI_FINALS:    [101,102],
  THIRD_PLACE:    [103],
  FINAL:          [104],
};

// Team-code aliases: API TLA → our data.js code.
// Extend this map if the API uses other abbreviations.
const TLA_ALIAS: Record<string, string> = {
  CUR: "CUW",  // Curaçao
  URY: "URU",  // Uruguay
};

const norm = (tla: string | null | undefined): string | null => {
  if (!tla) return null;
  const u = tla.toUpperCase();
  return TLA_ALIAS[u] ?? u;
};

serve(async (req) => {
  console.log("1 start");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ---- Auth: must be called by an authenticated admin ----
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  let user: any;
  try {
    const { data, error } = await supabaseUser.auth.getUser();
    if (error) throw error;
    user = data.user;
  } catch (err: any) {
    console.error("getUser failed:", err?.message);
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log("2 got user");

  let profile: any;
  try {
    const { data, error } = await supabaseAdmin
      .from("profiles").select("is_admin").eq("id", user.id).single();
    if (error) throw error;
    profile = data;
  } catch (err: any) {
    console.error("profiles query failed:", err?.message);
    return new Response(JSON.stringify({ error: "Failed to check admin status" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log("3 admin checked");

  if (!profile?.is_admin) {
    return new Response(JSON.stringify({ error: "Admin only" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ---- Call football-data.org server-side ----
  const apiKey = Deno.env.get("FOOTBALL_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "FOOTBALL_API_KEY secret not set on this project" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log("4 calling api");

  let apiMatches: any[];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
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
      throw new Error(`football-data.org returned ${apiRes.status}: ${text.slice(0, 200)}`);
    }
    const body = await apiRes.json();
    apiMatches = body.matches ?? [];
  } catch (err: any) {
    if (err.name === "AbortError") {
      return new Response(JSON.stringify({ error: "upstream timeout" }), {
        status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: `Upstream fetch failed: ${err.message}` }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log("5 api done " + apiMatches.length);

  // ---- Build knockout team lookup from seeded match_results ----
  // Bracket seeding writes home_team/away_team once groups finish, giving us a
  // robust team-code based mapping (same approach as group matches).
  const koTeamLookup = new Map<string, number>();
  try {
    const { data: koRows } = await supabaseAdmin
      .from("match_results")
      .select("match_id, home_team, away_team")
      .gte("match_id", 73)
      .not("home_team", "is", null);
    for (const km of (koRows ?? [])) {
      const h = norm(km.home_team), a = norm(km.away_team);
      if (h && a) {
        koTeamLookup.set(`${h}:${a}`, km.match_id);
        koTeamLookup.set(`${a}:${h}`, km.match_id); // tolerate API home/away inversion
      }
    }
  } catch { /* non-fatal — fall back to positional alignment */ }

  // ---- Build group-stage lookup: "GROUP:HOME:AWAY" → our match id ----
  // Both orientations stored so a home/away inversion in the API is tolerated.
  const groupLookup = new Map<string, number>();
  for (const [id, group, home, away] of GROUP_FIXTURES) {
    groupLookup.set(`${group}:${home}:${away}`, id);
    groupLookup.set(`${group}:${away}:${home}`, id);
  }

  // ---- Bucket & sort API matches by stage (by API id for positional alignment) ----
  const apiByStage = new Map<string, any[]>();
  for (const m of apiMatches) {
    if (!apiByStage.has(m.stage)) apiByStage.set(m.stage, []);
    apiByStage.get(m.stage)!.push(m);
  }
  for (const arr of apiByStage.values()) arr.sort((a, b) => a.id - b.id);

  // ---- Map each finished API match to our internal fixture ID ----
  const upserts: any[] = [];
  const unmapped: string[] = [];

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

    if (ourId == null) {
      if (isFinished) {
        unmapped.push(
          `stage=${stage} api#${match.id} ` +
          `${match.homeTeam?.tla ?? "?"} vs ${match.awayTeam?.tla ?? "?"} ` +
          `score=${match.score.fullTime.home}-${match.score.fullTime.away}`
        );
      }
      continue;
    }

    // For knockout ET/penalty matches, regularTime holds the 90-min score;
    // for normal-time matches regularTime is null so fall back to fullTime.
    // For live matches fullTime is null — use halfTime score, or fall back to 0-0.
    const reg      = match.score?.regularTime;
    const ft       = match.score?.fullTime;
    const duration = match.score?.duration; // REGULAR | EXTRA_TIME | PENALTY_SHOOTOUT
    const homeScore: number = (reg?.home != null ? reg.home : ft?.home)
      ?? match.score?.halfTime?.home
      ?? 0;
    const awayScore: number = (reg?.away != null ? reg.away : ft?.away)
      ?? match.score?.halfTime?.away
      ?? 0;

    // Capture after-ET and penalty info for display only — NOT used in scoring
    const wentToET = duration === 'EXTRA_TIME' || duration === 'PENALTY_SHOOTOUT';
    const ftHome:   number | null = wentToET ? (ft?.home   ?? null) : null;
    const ftAway:   number | null = wentToET ? (ft?.away   ?? null) : null;
    const pensHome: number | null = match.score?.penalties?.home ?? null;
    const pensAway: number | null = match.score?.penalties?.away ?? null;

    upserts.push({
      match_id:   ourId,
      home_score: homeScore,
      away_score: awayScore,
      ft_home:    ftHome,
      ft_away:    ftAway,
      pens_home:  pensHome,
      pens_away:  pensAway,
      status,
      updated_at: new Date().toISOString(),
    });
  }

  // ---- Upsert via service role (bypasses RLS) ----
  console.log("6 upserting " + upserts.length);
  if (upserts.length > 0) {
    const { error } = await supabaseAdmin
      .from("match_results")
      .upsert(upserts, { onConflict: "match_id" });

    if (error) {
      return new Response(JSON.stringify({ error: `DB upsert failed: ${error.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // ---- Propagate knockout winners into next-round slots ----
  // Same mapping as auto-update Step 6 — runs after every manual fetch so bracket
  // updates immediately when an admin triggers this function.
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
    const allKoIds = [73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,
                      89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104];
    const { data: koRows } = await supabaseAdmin
      .from('match_results')
      .select('match_id,home_team,away_team,home_score,away_score,ft_home,ft_away,pens_home,pens_away,status')
      .in('match_id', allKoIds);
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
      if (!propErr) koWinnersSeeded = propUpserts.length;
    }
    console.log("7b ko-propagate: " + koWinnersSeeded + " slots updated");
  } catch (e: any) {
    console.error("ko-propagate error (non-fatal):", e.message);
  }

  console.log("7 returning");
  return new Response(
    JSON.stringify({ updated: upserts.length, ko_winners_seeded: koWinnersSeeded, unmapped }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
