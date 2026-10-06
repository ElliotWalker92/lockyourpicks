-- ============================================================
--  0028 — the guided tour
--
--  Nine people learned this game from a WhatsApp message. The next one to
--  join won't have that, and the ones already playing have never been shown
--  the parts they don't happen to use. A walkthrough on first login costs
--  them a minute and saves the group explaining it again.
--
--  A timestamp rather than a boolean: "when did they see it" answers "have
--  they seen it" as well, and also tells us whether anyone who joined after
--  a change has seen the new version. Null means never.
-- ============================================================

alter table public.profiles
  add column if not exists tour_seen_at timestamptz;

comment on column public.profiles.tour_seen_at is
  'When this player finished or dismissed the guided tour. Null means it has never been shown — the tour runs on their next visit.';
