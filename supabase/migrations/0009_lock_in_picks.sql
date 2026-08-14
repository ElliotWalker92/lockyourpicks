-- ============================================================
--  Lock Your Picks v2 — one turn per player, with lock-in
--
--  Replaces the snake draft from 0002/0006. That model gave each
--  player nine separate turns and advanced after every single pick, so
--  you made one pick and immediately lost the turn — you could neither
--  change it nor take your other two.
--
--  New model:
--    * one turn per player per gameweek, not one per pick
--    * on your turn you make all three picks, and can change them
--      freely until you lock in
--    * locking in advances the turn; so does the clock running out
--    * turn order is a plain rotation by gameweek — GW1 starts with the
--      first player, GW2 the second, GW4 back to the first
-- ============================================================


-- ------------------------------------------------------------
--  draft_user_at_turn — plain rotation
--
--  There is now exactly one turn per player, so the turn index *is*
--  the seat index. The snake (A B C / C B A) existed to stop the first
--  picker taking the best fixture in every round; with one turn each
--  there are no rounds to balance.
-- ------------------------------------------------------------
create or replace function public.draft_user_at_turn(
  p_order uuid[],
  p_turn  integer
) returns uuid language sql immutable as $$
  select case
    when coalesce(array_length(p_order, 1), 0) = 0 then null
    when p_turn < 0 or p_turn >= array_length(p_order, 1) then null
    else p_order[p_turn + 1]
  end;
$$;


-- ------------------------------------------------------------
--  advance_draft_turn — total turns is now one per player
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

  v_total := array_length(v_draft.pick_order, 1);

  if v_draft.current_turn + 1 >= v_total then
    update public.drafts
       set status = 'complete', current_turn = v_total,
           turn_started_at = null, turn_expires_at = null, completed_at = now()
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
--  make_pick — adds a pick, does NOT advance the turn
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
  v_made     integer;
  v_pick     public.picks%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_draft from public.drafts where id = p_draft_id for update;
  if not found then raise exception 'Draft not found'; end if;

  if v_draft.status <> 'active' then
    raise exception 'Draft is not open for picks (status: %)', v_draft.status;
  end if;

  v_expected := public.draft_user_at_turn(v_draft.pick_order, v_draft.current_turn);
  if v_expected is distinct from v_uid then
    raise exception 'It is not your turn to pick';
  end if;

  if v_draft.turn_expires_at is not null and now() > v_draft.turn_expires_at then
    raise exception 'Your turn has expired';
  end if;

  select count(*) into v_made
    from public.picks
   where draft_id = p_draft_id and user_id = v_uid;

  if v_made >= v_draft.picks_per_player then
    raise exception 'You already have % picks. Remove one to swap it.',
      v_draft.picks_per_player;
  end if;

  select * into v_fixture from public.fixtures where id = p_fixture_id;
  if not found then raise exception 'Fixture not found'; end if;
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
      (p_draft_id, v_uid, p_fixture_id, p_outcome,
       v_draft.current_turn * v_draft.picks_per_player + v_made, false)
    returning * into v_pick;
  exception when unique_violation then
    raise exception 'That fixture has already been taken in this draft';
  end;

  return v_pick;
end;
$$;


-- ------------------------------------------------------------
--  remove_pick — take one back before locking in
--
--  Only your own, only on your turn, only before lock-in. Once the
--  turn has passed, the next player has drafted around your choices
--  and unpicking would rewrite their options retroactively.
-- ------------------------------------------------------------
create or replace function public.remove_pick(p_pick_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_pick     public.picks%rowtype;
  v_draft    public.drafts%rowtype;
  v_expected uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_pick from public.picks where id = p_pick_id;
  if not found then raise exception 'Pick not found'; end if;
  if v_pick.user_id <> v_uid then
    raise exception 'That is not your pick';
  end if;

  select * into v_draft from public.drafts where id = v_pick.draft_id for update;
  if v_draft.status <> 'active' then
    raise exception 'This draft is closed';
  end if;

  v_expected := public.draft_user_at_turn(v_draft.pick_order, v_draft.current_turn);
  if v_expected is distinct from v_uid then
    raise exception 'Your picks are locked in — you can only change them on your turn';
  end if;

  delete from public.picks where id = p_pick_id;
end;
$$;


-- ------------------------------------------------------------
--  lock_in_picks — commit your three and pass the turn on
-- ------------------------------------------------------------
create or replace function public.lock_in_picks(p_draft_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_draft    public.drafts%rowtype;
  v_expected uuid;
  v_made     integer;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_draft from public.drafts where id = p_draft_id for update;
  if not found then raise exception 'Draft not found'; end if;
  if v_draft.status <> 'active' then
    raise exception 'Draft is not open (status: %)', v_draft.status;
  end if;

  v_expected := public.draft_user_at_turn(v_draft.pick_order, v_draft.current_turn);
  if v_expected is distinct from v_uid then
    raise exception 'It is not your turn';
  end if;

  select count(*) into v_made
    from public.picks where draft_id = p_draft_id and user_id = v_uid;

  if v_made < v_draft.picks_per_player then
    raise exception 'Pick % fixtures before locking in — you have %.',
      v_draft.picks_per_player, v_made;
  end if;

  perform public.advance_draft_turn(p_draft_id);
  return v_made;
end;
$$;


-- ------------------------------------------------------------
--  auto_pick — fill whatever is missing, then lock the turn
--
--  Fires when the clock runs out. Uses the Elo model: largest
--  remaining rating edge including the 100-point home advantage, back
--  the favourite. Never predicts a draw — under Elo a draw peaks around
--  24% and is never the single most likely outcome.
--
--  Dropped first, not replaced: the previous version returned
--  public.picks and this one returns integer. CREATE OR REPLACE cannot
--  change a return type — it errors, leaving the old function in place
--  while the rest of the migration appears to succeed.
-- ------------------------------------------------------------
drop function if exists public.auto_pick(uuid);

create or replace function public.auto_pick(p_draft_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_draft   public.drafts%rowtype;
  v_uid     uuid;
  v_made    integer;
  v_choice  record;
  v_outcome public.outcome;
  v_added   integer := 0;
begin
  select * into v_draft from public.drafts where id = p_draft_id for update;
  if not found or v_draft.status <> 'active' then return 0; end if;

  v_uid := public.draft_user_at_turn(v_draft.pick_order, v_draft.current_turn);
  if v_uid is null then return 0; end if;

  select count(*) into v_made
    from public.picks where draft_id = p_draft_id and user_id = v_uid;

  while v_made < v_draft.picks_per_player loop
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

    exit when not found;   -- slate exhausted

    v_outcome := case when v_choice.edge >= 0 then 'HOME' else 'AWAY' end::public.outcome;

    insert into public.picks
      (draft_id, user_id, fixture_id, predicted_outcome, pick_number, is_auto_pick)
    values
      (p_draft_id, v_uid, v_choice.fixture_id, v_outcome,
       v_draft.current_turn * v_draft.picks_per_player + v_made, true);

    v_made  := v_made + 1;
    v_added := v_added + 1;
  end loop;

  perform public.advance_draft_turn(p_draft_id);
  return v_added;
end;
$$;


-- ------------------------------------------------------------
--  start_drafts_for_gameweek — rotation by gameweek, one turn each
--
--  Gameweek 1 starts with the first player, gameweek 2 the second,
--  gameweek 4 back to the first. (The previous version used
--  `number % n`, which started gameweek 1 on the *second* player.)
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
  if not found then raise exception 'Gameweek not found'; end if;

  for v_div in
    select d.id from public.divisions d
     where not exists (
       select 1 from public.drafts dr
        where dr.division_id = d.id and dr.gameweek_id = p_gameweek_id
     )
  loop
    select array_agg(dm.user_id order by dm.user_id)
      into v_order
      from public.division_members dm
     where dm.division_id = v_div.id;

    v_n := coalesce(array_length(v_order, 1), 0);
    continue when v_n = 0;

    v_shift := (v_gw.number - 1) % v_n;
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
         now() + (greatest(v_gw.draft_closes_at - now(), interval '0') / v_n)
       ))
    on conflict (division_id, gameweek_id) do nothing;

    if found then v_created := v_created + 1; end if;
  end loop;

  if v_created > 0 then
    update public.gameweeks set status = 'drafting'
     where id = p_gameweek_id and status = 'upcoming';
  end if;

  return v_created;
end;
$$;


-- ------------------------------------------------------------
--  Execution rights
-- ------------------------------------------------------------
revoke all on function public.advance_draft_turn(uuid)        from public, anon, authenticated;
revoke all on function public.auto_pick(uuid)                 from public, anon, authenticated;
revoke all on function public.start_drafts_for_gameweek(uuid) from public, anon, authenticated;

grant execute on function public.make_pick(uuid, uuid, public.outcome) to authenticated;
grant execute on function public.remove_pick(uuid)                      to authenticated;
grant execute on function public.lock_in_picks(uuid)                    to authenticated;
grant execute on function public.draft_user_at_turn(uuid[], integer)    to authenticated;
