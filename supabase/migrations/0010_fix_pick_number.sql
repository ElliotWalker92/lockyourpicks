-- ============================================================
--  Lock Your Picks v2 — pick_number must not be derived from a count
--
--  0009 computed pick_number as
--      current_turn * picks_per_player + (picks made so far)
--
--  which is stable only if picks are never removed. With lock-in you
--  can swap a pick before committing: removing one drops the count, so
--  the replacement reuses a number that already exists and trips
--  picks_draft_id_pick_number_key.
--
--  Worse, make_pick caught unique_violation and reported "That fixture
--  has already been taken in this draft" regardless of which constraint
--  fired — so a pick_number collision looked like a fixture clash and
--  sent debugging in the wrong direction entirely.
--
--  Fix: allocate pick_number as max+1 within the draft (gaps after a
--  removal are fine — it is an ordering hint, not an index), and
--  inspect the constraint name before deciding what to report.
-- ============================================================

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
  v_made       integer;
  v_next       integer;
  v_constraint text;
  v_pick       public.picks%rowtype;
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
    from public.picks where draft_id = p_draft_id and user_id = v_uid;

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

  -- Monotonic within the draft. The row lock above serialises this.
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
      raise;   -- anything else is a bug; don't disguise it
    end if;
  end;

  return v_pick;
end;
$$;


create or replace function public.auto_pick(p_draft_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_draft   public.drafts%rowtype;
  v_uid     uuid;
  v_made    integer;
  v_next    integer;
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

    exit when not found;

    v_outcome := case when v_choice.edge >= 0 then 'HOME' else 'AWAY' end::public.outcome;

    select coalesce(max(pick_number), -1) + 1 into v_next
      from public.picks where draft_id = p_draft_id;

    insert into public.picks
      (draft_id, user_id, fixture_id, predicted_outcome, pick_number, is_auto_pick)
    values
      (p_draft_id, v_uid, v_choice.fixture_id, v_outcome, v_next, true);

    v_made  := v_made + 1;
    v_added := v_added + 1;
  end loop;

  perform public.advance_draft_turn(p_draft_id);
  return v_added;
end;
$$;

grant execute on function public.make_pick(uuid, uuid, public.outcome) to authenticated;
revoke all on function public.auto_pick(uuid) from public, anon, authenticated;
