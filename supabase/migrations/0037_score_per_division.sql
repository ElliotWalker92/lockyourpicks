-- ============================================================
--  0037 — a score belongs to a division, not just a player
--
--  gameweek_scores was keyed on (user_id, gameweek_id): one score per
--  player per round. That holds exactly as long as nobody plays in two
--  groups at once.
--
--  Sean does now. He has gameweek 17 picks in Betting League Division 2 and
--  in Gillease League Division 1, so the roll-up inside settle_gameweek
--  produces two rows for him — correctly, they are two different runs at
--  two different boards. The insert ends `on conflict (user_id,
--  gameweek_id) do update`, Postgres refuses to touch the same row twice in
--  one statement, and the whole statement fails:
--
--    ON CONFLICT DO UPDATE command cannot affect row a second time
--
--  The statement is all-or-nothing, so nobody's score was written. Not
--  Sean's, not his division's, not the other three leagues'. Gameweek 17
--  has sat unsettled since Tuesday evening with every player on zero.
--
--  The results job caught it immediately and has reported this exact error
--  on every run since — seventy-two consecutive failures. The alerting
--  worked; what it could not say was that one player joining a second
--  group is what stopped four leagues being scored.
--
--  The key was the wrong shape. A score is what a player did in a division
--  in a round; the division is part of what identifies it, which is also
--  what every reader already assumes — division_standings joins on user and
--  division, and the league table filters by division.
-- ============================================================

alter table public.gameweek_scores
  drop constraint if exists gameweek_scores_pkey;

alter table public.gameweek_scores
  add primary key (user_id, gameweek_id, division_id);


-- Same function as 0014 with the conflict target corrected to match.
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

  update public.picks p
     set points_awarded = case when p.predicted_outcome = f.result then 1 else 0 end
    from public.fixtures f
   where p.fixture_id  = f.id
     and f.gameweek_id = p_gameweek_id
     and f.status      = 'finished'
     and f.result is not null;

  get diagnostics v_scored = row_count;

  update public.picks p
     set points_awarded = 0
    from public.fixtures f
   where p.fixture_id  = f.id
     and f.gameweek_id = p_gameweek_id
     and f.status in ('postponed', 'cancelled')
     and p.points_awarded is null;

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
  -- Matches the group by. Keyed on the player alone, somebody in two
  -- divisions produced two rows aimed at one, and the statement failed
  -- for everybody rather than only for them.
  on conflict (user_id, gameweek_id, division_id) do update
     set points        = excluded.points,
         correct_count = excluded.correct_count,
         settled_at    = excluded.settled_at;

  select count(*) into v_pending
    from public.fixtures
   where gameweek_id = p_gameweek_id
     and status not in ('finished', 'postponed', 'cancelled');

  if v_pending = 0 then
    update public.gameweeks
       set status = 'settled'
     where id = p_gameweek_id;

    select * into v_next
      from public.gameweeks
     where season_id = v_gw.season_id
       and number    > v_gw.number
       and status   <> 'settled'
     order by number
     limit 1;

    if found and v_next.draft_closes_at > now() then
      perform public.start_drafts_for_gameweek(v_next.id);
    end if;
  end if;

  return v_scored;
end;
$$;

revoke all on function public.settle_gameweek(uuid) from public, anon, authenticated;
