-- ============================================================
--  0041 — the Elo job has to be able to take a rating away
--
--  0040 made elo_rating nullable and cleared the ten clubs that had never
--  been stamped. Running the job afterwards reported seventeen it would not
--  rate, not ten. The other seven — Kidderminster, Oxford City, Marine, AFC
--  Hornchurch, AFC Rushden & Diamonds, Harborough Town, Wimborne Town — had
--  been stamped, under the old rule that gave every club DEFAULT_SEED when
--  it had no history. 0040 only cleared rows with no stamp, so they kept a
--  1300 nobody stands behind, and apply_team_elo touches only the rows it is
--  handed, so the job could not clear them either.
--
--  That is the worse number of the two. 1500 at least sat at the top of the
--  range where it looked like a default; 1300 sits between the Championship
--  and League One, so it reads as a considered rating. In GW22 it puts
--  Wimborne Town of the Southern League at the very top of auto_pick's
--  queue — edge 388, the most confident call in a 57-fixture gameweek — on
--  a club we hold not one result for.
--
--  So the job gets a way to say "no rating" and not merely "this rating":
--  an elo_rating of null in the payload clears the rating and the stamp
--  together. The rule for who has a basis stays in one place, in the job
--  (src/lib/ingest/elo.ts), rather than being written a second time here in
--  SQL — two copies of one rule drifting apart is how most of the bugs in
--  this schema's history started. Nothing is backfilled by this migration;
--  running the job is what applies it.
-- ============================================================

create or replace function public.apply_team_elo(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  -- A null elo_rating means "we have no basis for this club": clear the
  -- rating and the stamp together, so `stamped` keeps meaning `rated`.
  -- The job always sends the key, so a missing one would be a bug in the
  -- caller rather than a request to clear.
  update public.teams t
     set elo_rating     = (e->>'elo_rating')::numeric,
         elo_updated_at = case
                            when e->>'elo_rating' is null then null
                            else now()
                          end
    from jsonb_array_elements(p_rows) e
   where t.id = (e->>'id')::uuid;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.apply_team_elo(jsonb) from public, anon, authenticated;
grant execute on function public.apply_team_elo(jsonb) to service_role;
