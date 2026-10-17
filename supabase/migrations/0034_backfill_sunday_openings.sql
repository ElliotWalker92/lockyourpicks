-- ============================================================
--  0034 — apply the Sunday opening to the gameweeks already built
--
--  0030 moved a midweek round's opening to noon on the Sunday before it,
--  so the first notification stops landing on a Friday night. That rule
--  lives in the fixture ingest, which is where a gameweek's window is
--  decided — and a gameweek's window is decided once, when its row is
--  built. Every round for this season already existed.
--
--  So the change has been inert. Gameweek 17 opened at 20:00 on Friday the
--  16th, exactly as gameweek 15 did, and for the same reason: it inherited
--  the previous round's kickoff. Thirty of the forty-nine rounds still to
--  come are carrying the same thing.
--
--  The rule, in SQL so it can be applied to rows rather than only to new
--  ones: the latest Sunday noon that leaves at least two days before the
--  football, or the previous round's kickoff, whichever is later. Mirrors
--  sundayNoonBefore in src/lib/gameweek-blocks.ts — if one changes, so does
--  the other.
-- ============================================================

create or replace function public.sunday_noon_before(
  p_closes_at    timestamptz,
  p_min_lead     interval default interval '48 hours'
)
returns timestamptz language plpgsql immutable set search_path = public as $$
declare
  v_limit  timestamptz := p_closes_at - p_min_lead;
  v_local  timestamp;
  v_sunday timestamp;
  v_at     timestamptz;
begin
  v_local  := timezone('Europe/London', v_limit);
  -- dow 0 is Sunday, so subtracting it walks back to the most recent one.
  v_sunday := (v_local::date - extract(dow from v_local)::integer) + time '12:00';
  v_at     := timezone('Europe/London', v_sunday);

  -- Noon on a Sunday morning limit is still after it; a week earlier is a
  -- long window, which beats a window of hours.
  if v_at > v_limit then
    v_at := v_at - interval '7 days';
  end if;

  return v_at;
end;
$$;

grant execute on function public.sunday_noon_before(timestamptz, interval)
  to authenticated, service_role;


-- Only rounds that haven't opened yet. One that is already drafting has
-- people part-way through it, and moving its opening would say something
-- untrue about a draft that is visibly under way.
update public.gameweeks g
   set draft_opens_at = greatest(
         g.draft_opens_at,
         public.sunday_noon_before(g.draft_closes_at)
       )
 where g.draft_opens_at > now()
   and public.sunday_noon_before(g.draft_closes_at) > g.draft_opens_at;
