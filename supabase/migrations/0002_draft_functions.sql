-- ============================================================
--  Lock Your Picks v2 — draft engine
--
--  Every pick goes through make_pick(). Nothing writes to public.picks
--  directly: turn order, deadlines and fixture exclusivity are only
--  meaningful if the database enforces them, because the draft is
--  adversarial by design — players gain by denying each other fixtures,
--  so these are exactly the rules players are motivated to break.
-- ============================================================


-- ------------------------------------------------------------
--  Snake order
--
--  With order [A,B,C]:
--    round 0:  A B C
--    round 1:  C B A
--    round 2:  A B C
--  The first picker of a round picks last in the next, so no single
--  player holds the advantage within a gameweek. The array itself is
--  rotated per gameweek (see start_drafts_for_gameweek) so the
--  first-overall pick moves around across the season too.
-- ------------------------------------------------------------
create or replace function public.draft_user_at_turn(
  p_order uuid[],
  p_turn  integer
) returns uuid language sql immutable as $$
  select case
    when coalesce(array_length(p_order, 1), 0) = 0 then null
    when (p_turn / array_length(p_order, 1)) % 2 = 0
      then p_order[(p_turn % array_length(p_order, 1)) + 1]
    else p_order[array_length(p_order, 1) - (p_turn % array_length(p_order, 1))]
  end;
$$;


-- ------------------------------------------------------------
--  advance_draft_turn — internal; moves to the next turn or completes
--
--  Turn length is not fixed. A division of 3 making 3 picks each is 9
--  sequential turns; a fixed 24h window would run to 9 days and overrun
--  the gameweek it is drafting for. Instead the time remaining until
--  first kickoff is redivided among the turns still to come, so a fast
--  pick hands its slack to the players after it and the draft always
--  finishes before kickoff.
-- ------------------------------------------------------------
create or replace function public.advance_draft_turn(p_draft_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_draft     public.drafts%rowtype;
  v_total     integer;
  v_remaining integer;
  v_closes    timestamptz;
begin
  select * into v_draft from public.drafts where id = p_draft_id for update;
  if not found then
    raise exception 'Draft % not found', p_draft_id;
  end if;

  v_total := array_length(v_draft.pick_order, 1) * v_draft.picks_per_player;

  if v_draft.current_turn + 1 >= v_total then
    update public.drafts
       set status          = 'complete',
           current_turn    = v_total,
           turn_started_at = null,
           turn_expires_at = null,
           completed_at    = now()
     where id = p_draft_id;
    return;
  end if;

  select draft_closes_at into v_closes
    from public.gameweeks where id = v_draft.gameweek_id;

  v_remaining := v_total - (v_draft.current_turn + 1);

  update public.drafts
     set current_turn    = v_draft.current_turn + 1,
         turn_started_at = now(),
         turn_expires_at = least(
           v_closes,
           now() + (greatest(v_closes - now(), interval '0') / v_remaining)
         )
   where id = p_draft_id;
end;
$$;


-- ------------------------------------------------------------
--  make_pick — the only sanctioned way to claim a fixture
--
--  Takes a row lock on the draft, so concurrent calls serialise rather
--  than racing. The unique constraint on (draft_id, fixture_id) is the
--  backstop if two transactions somehow reach the insert together.
-- ------------------------------------------------------------
create or replace function public.make_pick(
  p_draft_id   uuid,
  p_fixture_id uuid,
  p_outcome    public.outcome
) returns public.picks
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_draft    public.drafts%rowtype;
  v_fixture  public.fixtures%rowtype;
  v_expected uuid;
  v_total    integer;
  v_pick     public.picks%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_draft from public.drafts where id = p_draft_id for update;
  if not found then
    raise exception 'Draft not found';
  end if;

  if v_draft.status <> 'active' then
    raise exception 'Draft is not open for picks (status: %)', v_draft.status;
  end if;

  v_total := array_length(v_draft.pick_order, 1) * v_draft.picks_per_player;
  if v_draft.current_turn >= v_total then
    raise exception 'Draft is already complete';
  end if;

  v_expected := public.draft_user_at_turn(v_draft.pick_order, v_draft.current_turn);
  if v_expected is distinct from v_uid then
    raise exception 'It is not your turn to pick';
  end if;

  if v_draft.turn_expires_at is not null and now() > v_draft.turn_expires_at then
    raise exception 'Your turn has expired';
  end if;

  select * into v_fixture from public.fixtures where id = p_fixture_id;
  if not found then
    raise exception 'Fixture not found';
  end if;
  if v_fixture.gameweek_id <> v_draft.gameweek_id then
    raise exception 'That fixture is not in this gameweek';
  end if;
  if v_fixture.status <> 'scheduled' then
    raise exception 'That fixture is not available (status: %)', v_fixture.status;
  end if;
  if v_fixture.kickoff_at <= now() then
    raise exception 'That fixture has already kicked off';
  end if;

  begin
    insert into public.picks
      (draft_id, user_id, fixture_id, predicted_outcome, pick_number, is_auto_pick)
    values
      (p_draft_id, v_uid, p_fixture_id, p_outcome, v_draft.current_turn, false)
    returning * into v_pick;
  exception when unique_violation then
    raise exception 'That fixture has already been taken in this draft';
  end;

  perform public.advance_draft_turn(p_draft_id);
  return v_pick;
end;
$$;


-- ------------------------------------------------------------
--  auto_pick — fires when a turn expires, so the draft never stalls
--
--  Uses the Elo model carried over from WC2026 (legacy/js/elo.js):
--  take the largest remaining rating edge, including the same 100-point
--  home advantage, and back the favourite. Deliberately never predicts a
--  draw — under Elo a draw peaks around 24% and is never the single most
--  likely outcome, so backing it would be a worse default.
-- ------------------------------------------------------------
create or replace function public.auto_pick(p_draft_id uuid)
returns public.picks
language plpgsql security definer set search_path = public as $$
declare
  v_draft   public.drafts%rowtype;
  v_uid     uuid;
  v_total   integer;
  v_choice  record;
  v_outcome public.outcome;
  v_pick    public.picks%rowtype;
begin
  select * into v_draft from public.drafts where id = p_draft_id for update;
  if not found or v_draft.status <> 'active' then
    return null;
  end if;

  v_total := array_length(v_draft.pick_order, 1) * v_draft.picks_per_player;
  if v_draft.current_turn >= v_total then
    return null;
  end if;

  v_uid := public.draft_user_at_turn(v_draft.pick_order, v_draft.current_turn);

  select f.id as fixture_id,
         (ht.elo_rating + 100 - at.elo_rating) as edge
    into v_choice
    from public.fixtures f
    join public.teams ht on ht.id = f.home_team_id
    join public.teams at on at.id = f.away_team_id
   where f.gameweek_id = v_draft.gameweek_id
     and f.status      = 'scheduled'
     and f.kickoff_at  > now()
     and not exists (
       select 1 from public.picks p
        where p.draft_id = p_draft_id and p.fixture_id = f.id
     )
   order by abs(ht.elo_rating + 100 - at.elo_rating) desc, f.kickoff_at asc
   limit 1;

  if not found then
    -- Slate exhausted (or everything has kicked off). Close rather than stall.
    update public.drafts
       set status = 'complete', completed_at = now(),
           turn_started_at = null, turn_expires_at = null
     where id = p_draft_id;
    return null;
  end if;

  v_outcome := case when v_choice.edge >= 0 then 'HOME' else 'AWAY' end::public.outcome;

  insert into public.picks
    (draft_id, user_id, fixture_id, predicted_outcome, pick_number, is_auto_pick)
  values
    (p_draft_id, v_uid, v_choice.fixture_id, v_outcome, v_draft.current_turn, true)
  returning * into v_pick;

  perform public.advance_draft_turn(p_draft_id);
  return v_pick;
end;
$$;


-- ------------------------------------------------------------
--  run_expired_turns — cron entry point
--
--  Loops because one sweep may need to auto-pick several turns in a row
--  if a whole division has gone quiet.
-- ------------------------------------------------------------
create or replace function public.run_expired_turns()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_draft_id uuid;
  v_count    integer := 0;
  v_guard    integer := 0;
begin
  loop
    v_guard := v_guard + 1;
    exit when v_guard > 500;   -- safety valve against an unexpected cycle

    select id into v_draft_id
      from public.drafts
     where status = 'active'
       and turn_expires_at is not null
       and turn_expires_at < now()
     order by turn_expires_at
     limit 1;

    exit when not found;

    perform public.auto_pick(v_draft_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


-- ------------------------------------------------------------
--  start_drafts_for_gameweek — opens a draft per division
--
--  The pick order rotates by gameweek number so the first-overall pick
--  moves through the division across the season.
-- ------------------------------------------------------------
create or replace function public.start_drafts_for_gameweek(p_gameweek_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_gw      public.gameweeks%rowtype;
  v_div     record;
  v_order   uuid[];
  v_n       integer;
  v_shift   integer;
  v_created integer := 0;
begin
  select * into v_gw from public.gameweeks where id = p_gameweek_id;
  if not found then
    raise exception 'Gameweek not found';
  end if;

  for v_div in
    select d.id, d.league_id from public.divisions d
  loop
    -- Members in a stable order, then rotated by gameweek number.
    select array_agg(dm.user_id order by dm.user_id)
      into v_order
      from public.division_members dm
     where dm.division_id = v_div.id;

    v_n := coalesce(array_length(v_order, 1), 0);
    continue when v_n = 0;

    v_shift := v_gw.number % v_n;
    if v_shift > 0 then
      v_order := v_order[v_shift + 1 : v_n] || v_order[1 : v_shift];
    end if;

    insert into public.drafts
      (division_id, gameweek_id, status, pick_order, current_turn,
       turn_started_at, turn_expires_at)
    values
      (v_div.id, p_gameweek_id, 'active', v_order, 0,
       now(),
       least(
         v_gw.draft_closes_at,
         now() + (greatest(v_gw.draft_closes_at - now(), interval '0')
                  / (v_n * 3))
       ))
    on conflict (division_id, gameweek_id) do nothing;

    if found then v_created := v_created + 1; end if;
  end loop;

  update public.gameweeks set status = 'drafting' where id = p_gameweek_id;
  return v_created;
end;
$$;


-- ------------------------------------------------------------
--  settle_gameweek — score every pick, then roll up per player
--
--  The whole scoring rule, straight from the spreadsheet's
--  =IF(PRED=RES,1,0).
-- ------------------------------------------------------------
create or replace function public.settle_gameweek(p_gameweek_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_scored integer;
begin
  update public.picks p
     set points_awarded = case when p.predicted_outcome = f.result then 1 else 0 end
    from public.fixtures f
    join public.drafts d on d.gameweek_id = f.gameweek_id
   where p.fixture_id = f.id
     and p.draft_id   = d.id
     and f.gameweek_id = p_gameweek_id
     and f.status      = 'finished'
     and f.result is not null;

  get diagnostics v_scored = row_count;

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

  update public.gameweeks set status = 'settled' where id = p_gameweek_id;
  return v_scored;
end;
$$;


-- ------------------------------------------------------------
--  Execution rights
--
--  make_pick is the only one players may call. The rest are operational
--  and run from cron or the service role.
-- ------------------------------------------------------------
revoke all on function public.advance_draft_turn(uuid)        from public, anon, authenticated;
revoke all on function public.auto_pick(uuid)                 from public, anon, authenticated;
revoke all on function public.run_expired_turns()             from public, anon, authenticated;
revoke all on function public.start_drafts_for_gameweek(uuid) from public, anon, authenticated;
revoke all on function public.settle_gameweek(uuid)           from public, anon, authenticated;

grant execute on function public.make_pick(uuid, uuid, public.outcome) to authenticated;
grant execute on function public.draft_user_at_turn(uuid[], integer)   to authenticated;
