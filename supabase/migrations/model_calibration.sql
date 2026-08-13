-- ============================================================
--  model_calibration
--
--  Stores pre-kickoff model probability snapshots for every
--  group-stage match, resolved with the actual outcome once
--  the match finishes.  Used purely for calibration analysis;
--  has no effect on scoring.
--
--  Columns:
--    match_id          — our internal match ID (PK)
--    elo_home/draw/away — three-way Elo probabilities at snapshot time
--    crowd_home/draw/away — crowd pick distribution at snapshot time
--    crowd_n            — number of crowd picks at snapshot time
--    blend_home/draw/away — weighted blend (default 70% Elo / 30% crowd)
--    blend_elo_weight   — effective Elo weight used (may be boosted for small samples)
--    actual_outcome     — 'home' | 'draw' | 'away', filled when match finishes
--    home_score/away_score — actual final score
--    snapshot_at        — when the prediction was locked in
--    resolved_at        — when the outcome was recorded
-- ============================================================

CREATE TABLE IF NOT EXISTS model_calibration (
  match_id          integer PRIMARY KEY,
  elo_home          numeric(7,5) NOT NULL,
  elo_draw          numeric(7,5) NOT NULL,
  elo_away          numeric(7,5) NOT NULL,
  crowd_home        numeric(7,5),
  crowd_draw        numeric(7,5),
  crowd_away        numeric(7,5),
  crowd_n           integer NOT NULL DEFAULT 0,
  blend_home        numeric(7,5) NOT NULL,
  blend_draw        numeric(7,5) NOT NULL,
  blend_away        numeric(7,5) NOT NULL,
  blend_elo_weight  numeric(5,3) NOT NULL DEFAULT 0.700,
  actual_outcome    text CHECK (actual_outcome IN ('home', 'draw', 'away')),
  home_score        integer,
  away_score        integer,
  snapshot_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz
);

ALTER TABLE model_calibration ENABLE ROW LEVEL SECURITY;

-- Admins (anon key) can read calibration data for the stats view
CREATE POLICY "public read model_calibration"
  ON model_calibration FOR SELECT TO anon USING (true);

-- service_role bypasses RLS by default; no extra policy needed for writes
