// ============================================================
//  WC2026 Prediction Game — Configuration
//  Fill in your keys before deploying
// ============================================================

const CONFIG = {
  // --- Supabase ---
  SUPABASE_URL: 'https://juknwgkehoatkbentidw.supabase.co',          // e.g. https://abcxyz.supabase.co
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1a253Z2tlaG9hdGtiZW50aWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NDgxNjMsImV4cCI6MjA5NjIyNDE2M30.D2tK0eqvj8i5uPTnAeVNksn5K6oPwZEr7aiYA-2ljOQ', // public anon key from Supabase dashboard

  // --- App Settings ---
  ADMIN_EMAIL: 'ehwalker92@gmail.com', // your email — gets admin privileges
  APP_NAME: 'WC2026 Predictor',
  APP_URL: 'https://www.lockyourpicks.com', // custom domain

  // --- Round lock times (ISO 8601 UTC) ---
  // Set these to just before each round's first kickoff
  ROUND_LOCKS: {
    round1: '2026-06-11T19:00:00Z', // Pre-tournament — locks at first kickoff
    round2: '2026-06-11T19:00:00Z', // Group winners — locks at first kickoff
    round3: '2026-06-27T22:00:00Z', // Group stage scores — final group match kickoff
    round4: '2026-07-04T01:30:00Z', // Round of 32 — fully locked once last R32 match (M87) kicks off
    round5: '2026-07-08T04:00:00Z', // R16 — after last R16 match: M96 Vancouver Jul 7 20:00 PDT = Jul 8 03:00 UTC
    round6: '2026-07-12T07:00:00Z', // QF  — after last QF match:  M100 KC Jul 12 01:00 CDT = Jul 12 06:00 UTC
    round7: '2026-07-16T00:00:00Z', // SF  — after last SF match:  M102 Atlanta Jul 15 19:00 EDT = Jul 15 23:00 UTC
    round8: '2026-07-19T23:00:00Z', // Final — M104 New York Jul 19 19:00 EDT = Jul 19 23:00 UTC
  }
};

// Scoring rules reference
const SCORING = {
  round1: {
    winner: 20,
    winner_runner_up: 10,   // picked winner but they were runner-up
    runner_up: 10,
    runner_up_winner: 5,    // picked runner-up but they won
    semi_finalist_correct: 10,
    semi_finalist_finalist: 5, // picked semi-finalist but they reached final
    top_scorer_name: 10,
    top_scorer_goals_exact: 10,
    golden_boot_name: 10,
    golden_boot_goals_exact: 10,
    group_goals_exact: 5,
    group_goals_within3: 3,
    most_goals_group: 5,
    red_cards_exact: 5,
    total_goals_exact: 10,
    total_goals_within3: 5,
  },
  round2: {
    group_winner_correct: 10,
    group_winner_top2: 5,    // picked winner but they were runner-up
    group_runnerup_correct: 10,
    group_runnerup_top2: 5,  // picked runner-up but they were group winner
    bonus_all6_winners: 10,
    bonus_5_winners: 5,
    bonus_all12_qualifiers: 10,
    bonus_10or11_qualifiers: 5,
  },
  round3: { exact_score: 7, correct_result: 5 },
  round4: { exact_score: 7, correct_result: 5 },
  round5: { exact_score: 7, correct_result: 5 },
  round6: { exact_score: 7, correct_result: 5 },
  round7: { exact_score: 7, correct_result: 5 },
  round8: { exact_score: 10, correct_result: 7 }, // Final
};

window.CONFIG = CONFIG;
window.SCORING = SCORING;
