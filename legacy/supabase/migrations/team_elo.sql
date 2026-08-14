-- ============================================================
-- WC2026 — Elo Rating Engine tables
-- ============================================================

-- team_elo: current rating for each WC2026 team
CREATE TABLE IF NOT EXISTS team_elo (
  team_code    TEXT         PRIMARY KEY,
  rating       NUMERIC(8,2) NOT NULL DEFAULT 1500,
  games_used   INTEGER      NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- elo_processed_matches: idempotency log — which WC match_ids have been applied
-- Prevents double-counting if elo-update runs multiple times
CREATE TABLE IF NOT EXISTS elo_processed_matches (
  match_id   INTEGER      PRIMARY KEY,
  applied_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  home_team  TEXT         NOT NULL,
  away_team  TEXT         NOT NULL,
  home_score INTEGER      NOT NULL,
  away_score INTEGER      NOT NULL,
  home_delta NUMERIC(8,2) NOT NULL,
  away_delta NUMERIC(8,2) NOT NULL
);

-- RLS: publicly readable (anon can query ratings for probability display)
--      service_role bypasses RLS for writes
ALTER TABLE team_elo             ENABLE ROW LEVEL SECURITY;
ALTER TABLE elo_processed_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_elo_public_read"
  ON team_elo FOR SELECT USING (true);

CREATE POLICY "elo_processed_public_read"
  ON elo_processed_matches FOR SELECT USING (true);
