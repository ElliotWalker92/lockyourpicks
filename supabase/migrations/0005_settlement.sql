-- ============================================================
--  Lock Your Picks v2 — settlement corrections
--
--  Replaces settle_gameweek from 0002, which had two problems:
--
--  1. It marked the gameweek 'settled' unconditionally. Called while
--     matches were still to play — which is exactly what a results
--     cron does — it would declare the week finished with half the
--     fixtures unplayed, and the leaderboard would look final when it
--     wasn't.
--
--  2. A pick on a postponed or cancelled fixture kept
--     points_awarded = NULL forever, indistinguishable from "not
--     scored yet". The player has spent one of their three picks on a
--     match that will never be played under that date.
-- ============================================================


-- ------------------------------------------------------------
--  settle_gameweek
--
--  Safe to call repeatedly — it scores what has finished and only
--  declares the gameweek settled once nothing is left to play.
--
--  Postponement rule: a drafted fixture that is postponed or cancelled
--  scores 0. The alternative — voiding it and granting a re-pick —
--  can't work once other players have drafted around it, because the
--  fixtures that were available at the time are gone.
-- ------------------------------------------------------------
create or replace function public.settle_gameweek(p_gameweek_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_scored  integer;
  v_pending integer;
begin
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


-- ------------------------------------------------------------
--  settle_due_gameweeks — cron entry point
--
--  Settles every gameweek whose draft has closed and which isn't
--  already settled. Returns how many it touched.
-- ------------------------------------------------------------
create or replace function public.settle_due_gameweeks()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_id      uuid;
  v_touched integer := 0;
begin
  for v_id in
    select id from public.gameweeks
     where draft_closes_at < now()
       and status <> 'settled'
     order by number
  loop
    perform public.settle_gameweek(v_id);
    v_touched := v_touched + 1;
  end loop;
  return v_touched;
end;
$$;

revoke all on function public.settle_due_gameweeks() from public, anon, authenticated;


-- ------------------------------------------------------------
--  Standings are derived, not stored.
--
--  Deliberately no table and no materialised view: a league table is a
--  sum over gameweek_scores, and a cached copy is one more thing to
--  fall out of step when a late result correction is rescored. At nine
--  players over ~43 gameweeks the aggregation is a few hundred rows.
--
--  Computed in src/app/(app)/table/page.tsx.
-- ------------------------------------------------------------
