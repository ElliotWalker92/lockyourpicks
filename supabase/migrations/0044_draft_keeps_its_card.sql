-- ============================================================
--  0044 — a round keeps the card it opened with
--
--  0042 refused to change a league's competitions while a draft was open,
--  on the grounds that adding fixtures mid-round hands them to whoever picks
--  next and nothing to the players who have already gone. The reasoning
--  holds; the remedy was the wrong one. It told an owner "you can't do this
--  now" when what they want to hear is "this starts next week", and it made
--  a decision wait on the football.
--
--  There is already a pattern for exactly this in here. A draft copies
--  `picks_per_player` from its league when it opens, so changing the
--  division size mid-season doesn't disturb a round in progress — the
--  LeagueShape form has said "a round already under way keeps the number it
--  opened with" since 0029.
--
--  So the card gets the same treatment. `drafts.competition_ids` is what
--  this round plays, frozen at the moment it opened. The league's own set
--  becomes what it plays *from now on*, which the owner may change whenever
--  they like, and the change lands when the next round opens.
--
--  One definition of the question, in draft_competitions(), because three
--  callers ask it — the board, make_pick and auto_pick — and three copies of
--  a rule is how this schema's worst bugs have started. It falls back to the
--  league's live set when a draft has no frozen card, which after the
--  backfill below means never, but is the right way round if it ever
--  happens: showing the league's current competitions is a cosmetic fault,
--  and showing none is the game not working.
-- ============================================================

alter table public.drafts
  add column if not exists competition_ids uuid[];

comment on column public.drafts.competition_ids is
  'The competitions this round was opened with. Frozen at open time so a change to the league''s set lands on the next round, never on one in progress — same reason picks_per_player is copied rather than read.';

-- Every draft that already exists was opened under its league's current set,
-- which for all of them is the English core: nothing else has ever been
-- turned on, and 0042 backfilled every league with it.
update public.drafts d
   set competition_ids = (
     select array_agg(lc.competition_id)
       from public.league_competitions lc
       join public.divisions dv on dv.league_id = lc.league_id
      where dv.id = d.division_id
   )
 where d.competition_ids is null;


-- ------------------------------------------------------------
--  What a round plays
-- ------------------------------------------------------------
create or replace function public.draft_competitions(p_draft_id uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(
           nullif(d.competition_ids, '{}'),
           array(
             select lc.competition_id
               from public.league_competitions lc
               join public.divisions dv on dv.league_id = lc.league_id
              where dv.id = d.division_id
           )
         )
    from public.drafts d
   where d.id = p_draft_id;
$$;

revoke all on function public.draft_competitions(uuid) from public, anon;
grant execute on function public.draft_competitions(uuid)
  to authenticated, service_role;


-- ------------------------------------------------------------
--  Opening a round writes the card onto it
-- ------------------------------------------------------------
--
--  Same function as 0029 with the league's competitions carried onto the
--  draft alongside its picks_per_player, which is already being copied for
--  the same reason two lines above.
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
    select d.id, d.rotation_offset,
           coalesce(l.picks_per_player, 3) as picks,
           array(
             select lc.competition_id
               from public.league_competitions lc
              where lc.league_id = l.id
           ) as competitions
      from public.divisions d
      join public.leagues l on l.id = d.league_id
     where d.season_id = v_gw.season_id
       and not exists (
         select 1 from public.drafts dr
          where dr.division_id = d.id and dr.gameweek_id = p_gameweek_id
       )
       and not exists (
         select 1
           from public.drafts dr
           join public.gameweeks g on g.id = dr.gameweek_id
          where dr.division_id = d.id
            and dr.status <> 'complete'
            and g.season_id   = v_gw.season_id
            and g.number      < v_gw.number
       )
  loop
    select array_agg(dm.user_id order by dm.seat, dm.user_id)
      into v_order
      from public.division_members dm
     where dm.division_id = v_div.id;

    v_n := coalesce(array_length(v_order, 1), 0);
    continue when v_n = 0;

    v_shift := (v_gw.number - 1 + coalesce(v_div.rotation_offset, 0)) % v_n;
    if v_shift > 0 then
      v_order := v_order[v_shift + 1 : v_n] || v_order[1 : v_shift];
    end if;

    insert into public.drafts
      (division_id, gameweek_id, status, pick_order, current_turn,
       picks_per_player, competition_ids, turn_started_at, turn_expires_at)
    values
      (v_div.id, p_gameweek_id, 'active', v_order, 0,
       v_div.picks,
       v_div.competitions,
       now(),
       public.turn_deadline(p_gameweek_id, v_n))
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

revoke all on function public.start_drafts_for_gameweek(uuid)
  from public, anon, authenticated;
grant execute on function public.start_drafts_for_gameweek(uuid) to service_role;


-- ------------------------------------------------------------
--  Picking, against the round's own card
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

  if not (
    v_fixture.competition_id = any (public.draft_competitions(p_draft_id))
  ) then
    raise exception 'That competition is not in this round';
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

grant execute on function public.make_pick(uuid, uuid, public.outcome) to authenticated;


create or replace function public.auto_pick(p_draft_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_draft   public.drafts%rowtype;
  v_cards   uuid[];
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

  v_cards := public.draft_competitions(p_draft_id);

  select count(*) into v_made
    from public.picks where draft_id = p_draft_id and user_id = v_uid;

  while v_made < v_draft.picks_per_player loop
    select f.id as fixture_id,
           (ht.elo_rating + 100 - at.elo_rating) as edge
      into v_choice
      from public.fixtures f
      join public.teams ht on ht.id = f.home_team_id
      join public.teams at on at.id = f.away_team_id
     where f.gameweek_id    = v_draft.gameweek_id
       and f.competition_id = any (v_cards)
       and f.status         = 'scheduled'
       and f.kickoff_at     > now()
       and not exists (
         select 1 from public.picks p
          where p.draft_id = p_draft_id and p.fixture_id = f.id
       )
     order by (ht.elo_rating is not null and at.elo_rating is not null) desc,
              abs(ht.elo_rating + 100 - at.elo_rating) desc,
              f.kickoff_at asc
     limit 1;

    exit when not found;

    -- A null edge means one of the sides is unrated, and coalesce makes the
    -- fallback explicit: with nothing to compare, back the home side.
    v_outcome := case when coalesce(v_choice.edge, 0) >= 0 then 'HOME' else 'AWAY' end::public.outcome;

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

revoke all on function public.auto_pick(uuid) from public, anon, authenticated;
grant execute on function public.auto_pick(uuid) to service_role;


-- ------------------------------------------------------------
--  Choosing, whenever the owner likes
-- ------------------------------------------------------------
--
--  Same function as 0042 without the refusal: a round in progress is no
--  longer a reason to say no, because it is no longer affected. What the
--  owner picks here is what the next round opens with.
create or replace function public.set_league_competitions(
  p_league_id uuid,
  p_competition_ids uuid[]
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_league public.leagues%rowtype;
  v_codes  text[];
begin
  if v_uid is null then
    raise exception 'You need to be signed in.';
  end if;

  select * into v_league from public.leagues where id = p_league_id;
  if not found then
    raise exception 'Group not found.';
  end if;

  if not (v_league.owner_id = v_uid or public.is_admin()) then
    raise exception 'Only the group owner can change this.';
  end if;

  -- Nulls out of the array first: `x <> all (array[...])` yields null for a
  -- null element, so the delete below would silently keep every row.
  p_competition_ids := coalesce(
    (select array_agg(x) from unnest(p_competition_ids) x where x is not null),
    '{}'::uuid[]
  );

  select array_agg(x::text) into v_codes
    from unnest(p_competition_ids) x
   where not exists (
     select 1 from public.competitions c where c.id = x and c.is_active
   );
  if v_codes is not null then
    raise exception 'Not a competition we offer: %', array_to_string(v_codes, ', ');
  end if;

  insert into public.league_competitions (league_id, competition_id)
  select p_league_id, c.id from public.competitions c where c.is_core
  on conflict do nothing;

  insert into public.league_competitions (league_id, competition_id)
  select p_league_id, x from unnest(p_competition_ids) x
  on conflict do nothing;

  delete from public.league_competitions lc
   where lc.league_id = p_league_id
     and lc.competition_id <> all (p_competition_ids)
     and not exists (
       select 1 from public.competitions c
        where c.id = lc.competition_id and c.is_core
     );

  select array_agg(c.code order by c.is_core desc, c.tier nulls last, c.code)
    into v_codes
    from public.league_competitions lc
    join public.competitions c on c.id = lc.competition_id
   where lc.league_id = p_league_id;

  return jsonb_build_object('competitions', v_codes);
end;
$$;

revoke all on function public.set_league_competitions(uuid, uuid[]) from public, anon;
grant execute on function public.set_league_competitions(uuid, uuid[]) to authenticated;
