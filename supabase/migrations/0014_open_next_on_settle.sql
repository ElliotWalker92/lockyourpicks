-- ============================================================
--  0014 — the next gameweek opens when the previous one settles
--
--  Drafting windows were driven purely by the calendar: draft_opens_at is
--  set when fixtures are ingested, and open_due_drafts picks the window up
--  when the clock reaches it. That leaves a gap. A gameweek that finishes
--  early — every result in on Sunday evening, the next window not due
--  until Tuesday — sits settled and idle with nothing for anyone to do,
--  and the league goes quiet in exactly the stretch people are most
--  interested in talking about it.
--
--  Settling is now the trigger: the moment a gameweek has nothing left to
--  play, the next one's window is pulled forward to now and its drafts are
--  created. The calendar still governs draft_closes_at, which is the first
--  kickoff and the one deadline that can't move.
-- ============================================================

create or replace function public.settle_gameweek(p_gameweek_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_scored  integer;
  v_pending integer;
  v_gw      public.gameweeks%rowtype;
  v_next    public.gameweeks%rowtype;
begin
  select * into v_gw from public.gameweeks where id = p_gameweek_id;
  if not found then raise exception 'Gameweek not found'; end if;

  -- Played fixtures: 1 point for calling the result.
  update public.picks p
     set points_awarded = case when p.predicted_outcome = f.result then 1 else 0 end
    from public.fixtures f
   where p.fixture_id  = f.id
     and f.gameweek_id = p_gameweek_id
     and f.status      = 'finished'
     and f.result is not null;

  get diagnostics v_scored = row_count;

  -- Abandoned fixtures: explicitly zero, so "scored 0" is distinguishable
  -- from "not scored yet".
  update public.picks p
     set points_awarded = 0
    from public.fixtures f
   where p.fixture_id  = f.id
     and f.gameweek_id = p_gameweek_id
     and f.status in ('postponed', 'cancelled')
     and p.points_awarded is null;

  -- Roll up per player. Recomputed from scratch each run, so a late
  -- result correction flows through on the next call.
  insert into public.gameweek_scores
    (user_id, gameweek_id, division_id, points, correct_count, settled_at)
  select p.user_id,
         p_gameweek_id,
         d.division_id,
         coalesce(sum(p.points_awarded), 0),
         coalesce(sum(p.points_awarded), 0),
         now()
    from public.picks p
    join public.drafts d on d.id = p.draft_id
   where d.gameweek_id = p_gameweek_id
   group by p.user_id, d.division_id
  on conflict (user_id, gameweek_id) do update
     set points        = excluded.points,
         correct_count = excluded.correct_count,
         settled_at    = excluded.settled_at;

  -- Only call it settled when there is genuinely nothing left to play.
  select count(*) into v_pending
    from public.fixtures
   where gameweek_id = p_gameweek_id
     and status not in ('finished', 'postponed', 'cancelled');

  -- Two plain statements rather than one CASE. A bare literal coerces to the
  -- enum; a CASE expression resolves to text first and the assignment fails
  -- with "column status is of type gameweek_status but expression is of type
  -- text". A cast fixes that, but not needing one is better.
  if v_pending = 0 then
    update public.gameweeks
       set status = 'settled'
     where id = p_gameweek_id;

    -- ---- Hand over to the next gameweek ----
    --
    -- Only the one immediately after, and only while there is still a
    -- window left to have: past draft_closes_at the first match has
    -- kicked off and the fixtures aren't draftable any more.
    select * into v_next
      from public.gameweeks
     where season_id = v_gw.season_id
       and number    > v_gw.number
       and status   <> 'settled'
     order by number
     limit 1;

    if found and v_next.draft_closes_at > now() then
      -- Pull the window forward, never push it back: if it opened on
      -- schedule already, leave the recorded time alone.
      if v_next.draft_opens_at > now() then
        update public.gameweeks
           set draft_opens_at = now()
         where id = v_next.id;
      end if;

      -- Idempotent: creates drafts only for divisions that lack one.
      perform public.start_drafts_for_gameweek(v_next.id);
    end if;
  else
    update public.gameweeks
       set status = 'live'
     where id = p_gameweek_id
       and status <> 'settled';
  end if;

  return v_scored;
end;
$$;

revoke all on function public.settle_gameweek(uuid) from public, anon, authenticated;
