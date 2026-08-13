// ============================================================
//  WC2026 — Supabase Edge Function: recalculate-scores
//  Deploy: supabase functions deploy recalculate-scores
//
//  This function runs with the service_role key so it can
//  bypass RLS and write to the scores table.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Scoring constants (mirror of client-side scoring.js)
const EXACT_PTS   = { round3: 7, round4: 7, round5: 7, round6: 7, round7: 7, round8: 10 };
const RESULT_PTS  = { round3: 5, round4: 5, round5: 5, round6: 5, round7: 5, round8: 7  };

// Group fixture map: [id, group, homeTeam, awayTeam]
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

const GROUPS = ["A","B","C","D","E","F","G","H","I","J","K","L"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Check auth — must be called by an authenticated admin
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Create admin client with service_role key
  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  // Verify the requesting user is an admin
  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles").select("is_admin").eq("id", user.id).single();

  if (!profile?.is_admin) {
    return new Response(JSON.stringify({ error: "Admin only" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Get optional userId filter from body
  let targetUserId: string | null = null;
  try {
    const body = await req.json();
    targetUserId = body?.userId || null;
  } catch (_) {}

  try {
    // 1. Fetch all match results (max 104 matches; explicit limit guards PostgREST default cap)
    const { data: matchResults } = await supabaseAdmin
      .from("match_results").select("*").limit(200);

    const resultMap: Record<number, any> = {};
    (matchResults || []).forEach((r: any) => { resultMap[r.match_id] = r; });

    console.log(`[recalculate-scores] match_results fetched: ${matchResults?.length ?? 0}`);

    // 2. Fetch all predictions via pagination — PostgREST max-rows caps any single
    //    request at 1000 rows regardless of .limit(); paginate to get everything.
    const PAGE_SIZE = 1000;
    const allPredictions: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let q = supabaseAdmin
        .from("predictions")
        .select("*")
        .range(from, from + PAGE_SIZE - 1);
      if (targetUserId) q = q.eq("user_id", targetUserId);
      const { data: page, error: pageErr } = await q;
      if (pageErr) throw pageErr;
      if (!page || page.length === 0) break;
      allPredictions.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    console.log(`[recalculate-scores] predictions fetched: ${allPredictions.length}${targetUserId ? ` (filtered to user ${targetUserId})` : ""}`);

    // 3. Group predictions by user indexed by matchId, and build match→round map from existing data
    const userPreds: Record<string, Record<string, Record<number, any>>> = {};
    const userR2Preds: Record<string, Record<string, string>> = {};
    const matchRoundMap: Record<number, string> = {};
    (allPredictions || []).forEach((p: any) => {
      if (p.question_key.startsWith("2.")) {
        let val: string | null = null;
        try { val = JSON.parse(p.value); } catch { val = p.value; }
        if (!val) return;
        const subKey = p.question_key.slice(2); // "w.A", "r.A", etc.
        if (!userR2Preds[p.user_id]) userR2Preds[p.user_id] = {};
        userR2Preds[p.user_id][subKey] = val;
        return;
      }
      if (!p.question_key.startsWith("m")) return;
      const matchId = parseInt(p.question_key.slice(1));
      if (isNaN(matchId)) return;
      if (!matchRoundMap[matchId]) matchRoundMap[matchId] = p.round;
      if (!userPreds[p.user_id]) userPreds[p.user_id] = {};
      if (!userPreds[p.user_id][p.round]) userPreds[p.user_id][p.round] = {};
      userPreds[p.user_id][p.round][matchId] = p;
    });

    // Fetch all profiles so zero-prediction players still get a scores row
    const allProfiles: any[] = [];
    if (!targetUserId) {
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data: page, error: pageErr } = await supabaseAdmin
          .from("profiles").select("id").range(from, from + PAGE_SIZE - 1);
        if (pageErr) throw pageErr;
        if (!page || page.length === 0) break;
        allProfiles.push(...page);
        if (page.length < PAGE_SIZE) break;
      }
    } else {
      allProfiles.push({ id: targetUserId });
    }

    const allUserIds = new Set<string>([
      ...Object.keys(userPreds),
      ...allProfiles.map((p: any) => p.id),
    ]);

    console.log(`[recalculate-scores] users to score: ${allUserIds.size} (${Object.keys(userPreds).length} with predictions, ${allProfiles.length} profiles fetched)`);

    // Pre-index matches-with-results by round
    const matchesByRound: Record<string, number[]> = {};
    for (const [matchIdStr, result] of Object.entries(resultMap)) {
      const matchId = parseInt(matchIdStr);
      const round = matchRoundMap[matchId];
      if (!round) continue;
      if (result.home_score === null || result.away_score === null) continue;
      if (result.status !== 'FINISHED') continue;
      if (!matchesByRound[round]) matchesByRound[round] = [];
      matchesByRound[round].push(matchId);
    }

    // Derive Round 2 group standings from finished matches
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

    // 4. Calculate scores per user; default 4-4 for any match with a result but no prediction
    const scoreUpdates: any[] = [];
    let totalDefaultFills = 0;

    for (const userId of allUserIds) {
      const roundPreds = userPreds[userId] || {};
      const scores: Record<string, number> = {
        round1: 0, round2: 0, round3: 0, round4: 0,
        round5: 0, round6: 0, round7: 0, round8: 0
      };

      for (const round of ["round3", "round4", "round5", "round6", "round7", "round8"]) {
        const exactP         = EXACT_PTS[round as keyof typeof EXACT_PTS];
        const resultP        = RESULT_PTS[round as keyof typeof RESULT_PTS];
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
            // No submitted prediction — treat as 4-4 (rare scoreline, almost never earns points)
            predH = 4; predA = 4;
            totalDefaultFills++;
          }

          if (predH === actH && predA === actA) {
            pts += exactP;
          } else if (Math.sign(predH - predA) === Math.sign(actH - actA)) {
            pts += resultP;
          }
        }
        scores[round] = pts;
      }

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

      // Preserve existing round1 score (scored separately)
      const { data: existingScore } = await supabaseAdmin
        .from("scores").select("round1_points").eq("user_id", userId).single();

      scores.round1 = existingScore?.round1_points || 0;

      const total = Object.values(scores).reduce((a, b) => a + b, 0);

      scoreUpdates.push({
        user_id:       userId,
        round1_points: scores.round1,
        round2_points: scores.round2,
        round3_points: scores.round3,
        round4_points: scores.round4,
        round5_points: scores.round5,
        round6_points: scores.round6,
        round7_points: scores.round7,
        round8_points: scores.round8,
        total_points:  total,
        updated_at:    new Date().toISOString()
      });
    }

    console.log(`[recalculate-scores] default 4-4 fills: ${totalDefaultFills}`);

    console.log(`[recalculate-scores] score rows to write: ${scoreUpdates.length}`);

    // 5. Upsert all score rows
    if (scoreUpdates.length > 0) {
      const { error } = await supabaseAdmin
        .from("scores")
        .upsert(scoreUpdates, { onConflict: "user_id" });

      if (error) throw error;
    }

    return new Response(
      JSON.stringify({
        success: true,
        version: "v4-round2-scoring",
        matchResultsLoaded: matchResults?.length ?? 0,
        predictionsLoaded: allPredictions?.length ?? 0,
        usersUpdated: scoreUpdates.length,
        defaultFills: totalDefaultFills,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
