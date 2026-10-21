-- ============================================================
--  0039 — say which competitions decide the calendar
--
--  A gameweek is a block of fixtures, cut from whatever has been ingested.
--  syncGameweeks re-cuts every round that hasn't been drafted yet from all
--  loose fixtures, so the boundaries are a function of the fixture list.
--
--  That is fine while the fixture list is one thing. The moment a group can
--  opt into the Champions League, it stops being: eight hundred European
--  ties would land in the middle of the season and the un-drafted rounds
--  would be re-cut around them — for every group, including the ones that
--  never asked for any of it. A Tuesday that was a quiet midweek round
--  becomes a block of its own, deadlines move, and somebody who plays only
--  English football finds their week has changed because somebody else
--  ticked a box.
--
--  So the calendar gets a spine. The competitions marked here are the ones
--  whose fixtures decide where a gameweek starts and ends; everything else
--  is assigned into whichever round it falls in and has no say over the
--  shape. English football is the spine because that is what this game has
--  always been cut around, and the four leagues plus the two cups are
--  present in every week of the season between them.
--
--  Nothing changes today: every competition currently ingested is part of
--  the spine, so the blocks come out exactly as they did before. This only
--  matters the first time something is added that shouldn't move anybody's
--  deadline.
-- ============================================================

alter table public.competitions
  add column if not exists sets_calendar boolean not null default true;

comment on column public.competitions.sets_calendar is
  'Whether this competition''s fixtures decide gameweek boundaries. The English spine does; anything added later is slotted into the rounds the spine defines.';
