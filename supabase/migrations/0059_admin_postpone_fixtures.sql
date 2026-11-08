-- ============================================================
--  Let an admin call a fixture off, and let the players it hit pick again
--
--  The provider is slow on EFL postponements. Five League One games in
--  gameweek 23 were called off for international call-ups and
--  API-Football still had every one of them as "not started", so the
--  board kept offering games that will not be played. The board already
--  hides a postponed fixture and make_pick already refuses one -- there
--  was simply no way to say a fixture was off without waiting for a
--  provider that had not noticed.
--
--  Fixtures are global, shared by every league, so this is admin-only.
--  A league owner marking one off would reach into everybody else's
--  round.
--
--  The hard part is not the flag, it is the picks already on it. A
--  player is given one turn and takes their whole quota in it; once the
--  turn has passed, draft_user_at_turn never names them again. So
--  deleting their pick would leave them a pick short with no way on
--  earth to replace it. make_pick is widened below for exactly that
--  case, and nothing wider.
-- ============================================================

-- ------------------------------------------------------------
--  Mark a fixture off, releasing any picks on it
-- ------------------------------------------------------------
create or replace function public.admin_set_fixture_status(
  p_fixture_id uuid,
  p_status     public.fixture_status
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_released integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  if p_status not in ('scheduled', 'postponed', 'cancelled') then
    raise exception 'Use this for scheduled, postponed or cancelled only, not %',
      p_status;
  end if;

  -- Releasing the picks before the status changes, so a player who is
  -- watching the board sees the fixture leave and their slip open up in
  -- the same breath rather than one and then the other.
  if p_status in ('postponed', 'cancelled') then
    delete from public.picks p
     using public.drafts d, public.gameweeks g
     where p.fixture_id = p_fixture_id
       and d.id = p.draft_id
       and g.id = d.gameweek_id
       -- A round that has already closed is history. Reopening it would
       -- change a settled table, and the player cannot pick again anyway.
       and g.draft_closes_at > now();
    get diagnostics v_released = row_count;
  end if;

  update public.fixtures
     set status = p_status, updated_at = now()
   where id = p_fixture_id;

  if not found then
    raise exception 'Fixture not found';
  end if;

  return v_released;
end;
$$;

revoke all     on function public.admin_set_fixture_status(uuid, public.fixture_status) from public, anon;
grant  execute on function public.admin_set_fixture_status(uuid, public.fixture_status) to authenticated;

comment on function public.admin_set_fixture_status(uuid, public.fixture_status) is
  'Admin-only. Sets a fixture''s status and, when calling it off, deletes '
  'picks on it in rounds that are still open so those players can pick '
  'again. Returns how many picks were released.';


-- ------------------------------------------------------------
--  make_pick: allow a replacement pick, and only a replacement pick
-- ------------------------------------------------------------
create or replace function public.make_pick(
  p_draft_id   uuid,
  p_fixture_id uuid,
  p_outcome    public.outcome
) returns public.picks
language plpgsql security definer set search_path = public as $$
declare
  v_uid        uuid := auth.uid();
  v_draft      public.drafts%rowtype;
  v_fixture    public.fixtures%rowtype;
  v_expected   uuid;
  v_seat       integer;
  v_made       integer;
  v_next       integer;
  v_closes     timestamptz;
  v_constraint text;
  v_pick       public.picks%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_draft from public.drafts where id = p_draft_id for update;
  if not found then raise exception 'Draft not found'; end if;

  v_expected := public.draft_user_at_turn(v_draft.pick_order, v_draft.current_turn);
  v_seat     := array_position(v_draft.pick_order, v_uid) - 1;

  select count(*) into v_made
    from public.picks where draft_id = p_draft_id and user_id = v_uid;

  if v_expected is not distinct from v_uid then
    -- The ordinary path: it is your turn.
    if v_draft.status <> 'active' then
      raise exception 'Draft is not open for picks (status: %)', v_draft.status;
    end if;
    if v_draft.turn_expires_at is not null and now() > v_draft.turn_expires_at then
      raise exception 'Your turn has expired';
    end if;
  else
    -- A replacement: your turn has been and gone and you are under quota,
    -- which can only happen because a fixture you took was called off.
    -- Anyone else who is not at the turn is simply out of order, and the
    -- clock on the current turn is no concern of theirs.
    -- Only the seat check belongs here. Folding the quota test in as
    -- well told a player who was simply full that it was not their turn,
    -- which is both wrong and unhelpful; the shared quota check below
    -- says what is actually the matter.
    if v_seat is null or v_seat >= v_draft.current_turn then
      raise exception 'It is not your turn to pick';
    end if;

    select draft_closes_at into v_closes
      from public.gameweeks where id = v_draft.gameweek_id;
    if v_closes is null or v_closes <= now() then
      raise exception 'This round has closed';
    end if;
  end if;

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

  if not (
    v_fixture.competition_id = any (public.draft_competitions(p_draft_id))
  ) then
    raise exception 'That competition is not in this round';
  end if;

  select coalesce(max(pick_number), -1) + 1 into v_next
    from public.picks where draft_id = p_draft_id;

  begin
    insert into public.picks
      (draft_id, user_id, fixture_id, predicted_outcome, pick_number, is_auto_pick)
    values
      (p_draft_id, v_uid, p_fixture_id, p_outcome, v_next, false)
    returning * into v_pick;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'picks_draft_id_fixture_id_key' then
      raise exception 'That fixture has already been taken in this draft';
    else
      raise;
    end if;
  end;

  return v_pick;
end;
$$;
