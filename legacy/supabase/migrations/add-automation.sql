-- ============================================================
--  WC2026 — Automation Migration
--  Run this entire file in Supabase Dashboard → SQL Editor
-- ============================================================


-- ============================================================
--  TABLE: settings
--  Key-value store for runtime configuration (kill-switch etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.settings (key, value)
VALUES ('auto_update_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read settings (kill-switch status visible in admin UI)
CREATE POLICY "settings: authenticated read"
  ON public.settings FOR SELECT TO authenticated USING (TRUE);

-- Only service_role (edge functions) and admins can write
CREATE POLICY "settings: admin write"
  ON public.settings FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

GRANT SELECT ON public.settings TO anon, authenticated;
GRANT INSERT, UPDATE ON public.settings TO authenticated;


-- ============================================================
--  TABLE: automation_logs
--  One row per auto-update run — for audit and monitoring
-- ============================================================
CREATE TABLE IF NOT EXISTS public.automation_logs (
  id               BIGSERIAL PRIMARY KEY,
  run_at           TIMESTAMPTZ DEFAULT NOW(),
  triggered_by     TEXT        DEFAULT 'cron',   -- 'cron' | 'manual'
  status           TEXT        NOT NULL,          -- 'success' | 'skipped_disabled' | 'error'
  results_updated  INTEGER     DEFAULT 0,
  players_rescored INTEGER     DEFAULT 0,
  default_fills    INTEGER     DEFAULT 0,
  error_message    TEXT,
  duration_ms      INTEGER
);

-- Keep logs tidy — auto-delete rows older than 30 days
-- (optional: comment this out if you want to keep everything)
-- CREATE OR REPLACE FUNCTION public.prune_automation_logs()
-- RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
--   DELETE FROM public.automation_logs WHERE run_at < NOW() - INTERVAL '30 days';
-- $$;

ALTER TABLE public.automation_logs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read (admin UI shows the log table)
CREATE POLICY "automation_logs: authenticated read"
  ON public.automation_logs FOR SELECT TO authenticated USING (TRUE);

-- service_role writes (edge function); admins may also write
CREATE POLICY "automation_logs: admin write"
  ON public.automation_logs FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

GRANT SELECT ON public.automation_logs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.automation_logs_id_seq TO authenticated;


-- ============================================================
--  pg_cron: Schedule the auto-update edge function
--
--  Prerequisites:
--    1. Enable pg_net:  Database → Extensions → pg_net (toggle on)
--    2. Enable pg_cron: Database → Extensions → pg_cron (toggle on)
--
--  Replace REPLACE_WITH_SERVICE_ROLE_KEY below with the value from:
--    Settings → API → service_role key
--
--  To view scheduled jobs:   SELECT * FROM cron.job;
--  To disable (don't delete): UPDATE cron.job SET active = FALSE WHERE jobname = 'wc2026-auto-update';
--  To re-enable:              UPDATE cron.job SET active = TRUE  WHERE jobname = 'wc2026-auto-update';
--  To delete entirely:        SELECT cron.unschedule('wc2026-auto-update');
-- ============================================================

SELECT cron.schedule(
  'wc2026-auto-update',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://juknwgkehoatkbentidw.supabase.co/functions/v1/auto-update',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer REPLACE_WITH_SERVICE_ROLE_KEY'
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
