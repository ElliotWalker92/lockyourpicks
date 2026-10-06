-- ============================================================
--  0029 — let a group choose its own shape
--
--  How many play in a division, and how many fixtures each of them takes,
--  are the two numbers that decide whether a group can run at all. They
--  multiply: a division needs size × picks distinct fixtures every single
--  gameweek, because once somebody takes a match nobody else in that
--  division can have it.
--
--  Division size was already the owner's to set. Picks per player was not
--  settable anywhere — every draft took the column default of 3, and no
--  insert has ever named it — so a group of six had no way to work. On
--  this season's fixtures the tightest gameweeks carry ten matches, which
--  is the whole constraint:
--
--      3 players x 3 picks = 9   fits
--      4 players x 2 picks = 8   fits
--      5 players x 2 picks = 10  fits exactly
--      4 players x 3 picks = 12  does not
--
--  So the second number has to move when the first one does, and the floor
--  is not a constant anyone can hardcode — it depends on the fixture list.
--  fixture_floor answers it from the data.
-- ============================================================

alter table public.leagues
  add column if not exists picks_per_player integer not null default 3;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'picks_per_player_sane'
  ) then
    alter table public.leagues
      add constraint picks_per_player_sane
      check (picks_per_player between 1 and 5);
  end if;
end $$;

comment on column public.leagues.picks_per_player is
  'How many fixtures each player takes per gameweek. Applied to drafts as they open; a draft already running keeps the number it started with.';


-- ------------------------------------------------------------
--  How much room the fixture list leaves
-- ------------------------------------------------------------
--
--  The smallest gameweek still to be drafted, counted in fixtures. A
--  division cannot need more than this, and the answer changes as the
--  season goes on: the thin gameweeks are the ones with a cup round or an
--  international break eating the card, and once they're behind us the
--  floor rises.
--
--  Gameweeks already closed are excluded because they can't constrain
--  anything; a group changing its shape now is choosing for the rounds it
--  has left.
create or replace function public.fixture_floor(p_season uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(min(c), 0)
    from (
      select count(f.id) as c
        from public.gameweeks g
        join public.fixtures f on f.gameweek_id = g.id
       where g.season_id = p_season
         and g.draft_closes_at > now()
       group by g.id
    ) per_gameweek;
$$;

grant execute on function public.fixture_floor(uuid) to authenticated, service_role;


-- ------------------------------------------------------------
--  Changing the shape
-- ------------------------------------------------------------
--
--  Both numbers together, because they are only valid together: checking
--  one against the other's stored value would let an owner walk a group
--  into an impossible pair one save at a time.
--
--  Division size is checked against the real divisions as well as the
--  fixtures. Shrinking it below a division that already exists would leave
--  those players in a division the rules say is too big, so it is refused
--  and the owner is told to re-arrange first.
create or replace function public.set_league_shape(
  p_league_id uuid,
  p_division_size integer,
  p_picks_per_player integer
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_league  public.leagues%rowtype;
  v_season  uuid;
  v_floor   integer;
  v_biggest integer;
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

  if p_division_size is null or not (p_division_size between 2 and 10) then
    raise exception 'A division holds between 2 and 10 players.';
  end if;

  if p_picks_per_player is null or not (p_picks_per_player between 1 and 5) then
    raise exception 'Each player takes between 1 and 5 fixtures.';
  end if;

  select id into v_season from public.seasons where is_active;
  v_floor := coalesce(public.fixture_floor(v_season), 0);

  if v_floor > 0 and p_division_size * p_picks_per_player > v_floor then
    raise exception
      '% players taking % each needs % fixtures, and the smallest gameweek left has %.',
      p_division_size, p_picks_per_player,
      p_division_size * p_picks_per_player, v_floor;
  end if;

  select max(n) into v_biggest
    from (
      select count(*) as n
        from public.division_members dm
        join public.divisions d on d.id = dm.division_id
       where d.league_id = p_league_id
         and d.season_id = v_season
       group by d.id
    ) sizes;

  if coalesce(v_biggest, 0) > p_division_size then
    raise exception
      'A division already has % players. Re-arrange the divisions first, or keep the size at % or more.',
      v_biggest, v_biggest;
  end if;

  update public.leagues
     set division_size   = p_division_size,
         picks_per_player = p_picks_per_player
   where id = p_league_id;

  return jsonb_build_object(
    'division_size', p_division_size,
    'picks_per_player', p_picks_per_player,
    'floor', v_floor
  );
end;
$$;

revoke all on function public.set_league_shape(uuid, integer, integer)
  from public, anon;
grant execute on function public.set_league_shape(uuid, integer, integer)
  to authenticated;


-- ------------------------------------------------------------
--  Drafts take the number from their group
-- ------------------------------------------------------------
--
--  Both of these are copied from 0026 with one line added to each: the
--  insert now names picks_per_player. Without it every draft keeps taking
--  the column default and the setting above would be decoration.
--
--  The value is copied onto the draft rather than read through to the
--  league, so a round already under way can't change shape underneath the
--  people playing it.
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
           coalesce(l.picks_per_player, 3) as picks
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
       picks_per_player, turn_started_at, turn_expires_at)
    values
      (v_div.id, p_gameweek_id, 'active', v_order, 0,
       v_div.picks,
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


create or replace function public.open_next_gameweek_for_league(
  p_league_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_league    public.leagues%rowtype;
  v_season    uuid;
  v_current   public.gameweeks%rowtype;
  v_next      public.gameweeks%rowtype;
  v_pending   integer;
  v_div       record;
  v_order     uuid[];
  v_n         integer;
  v_shift     integer;
  v_created   integer := 0;
begin
  if v_uid is null then
    raise exception 'You need to be signed in.';
  end if;

  select * into v_league from public.leagues where id = p_league_id;
  if not found then
    raise exception 'Group not found.';
  end if;

  if not (v_league.owner_id = v_uid or public.is_admin()) then
    raise exception 'Only the group owner can start the next round.';
  end if;

  select id into v_season from public.seasons where is_active;
  if v_season is null then
    raise exception 'No active season.';
  end if;

  select g.* into v_current
    from public.gameweeks g
    join public.drafts d on d.gameweek_id = g.id
    join public.divisions dv on dv.id = d.division_id
   where dv.league_id = p_league_id
     and dv.season_id = v_season
   order by g.number desc
   limit 1;

  if not found then
    raise exception 'This group has not drafted a gameweek yet.';
  end if;

  select count(*) into v_pending
    from public.drafts d
    join public.divisions dv on dv.id = d.division_id
   where dv.league_id = p_league_id
     and dv.season_id = v_season
     and d.gameweek_id = v_current.id
     and d.status <> 'complete';

  if v_pending > 0 then
    raise exception
      'Still waiting on % division(s) to finish gameweek %.',
      v_pending, v_current.number;
  end if;

  select * into v_next
    from public.gameweeks
   where season_id = v_current.season_id
     and number > v_current.number
   order by number
   limit 1;

  if not found then
    raise exception 'There is no next gameweek to open.';
  end if;

  if v_next.draft_closes_at <= now() then
    raise exception
      'Gameweek % has already kicked off.', v_next.number;
  end if;

  if exists (
    select 1 from public.drafts d
      join public.divisions dv on dv.id = d.division_id
     where dv.league_id = p_league_id
       and dv.season_id = v_season
       and d.gameweek_id = v_next.id
  ) then
    return jsonb_build_object(
      'opened', false,
      'gameweek', v_next.number,
      'message', format('Gameweek %s is already open.', v_next.number)
    );
  end if;

  if v_next.draft_opens_at > now() then
    update public.gameweeks
       set draft_opens_at = now()
     where id = v_next.id;
  end if;

  for v_div in
    select d.id, d.rotation_offset from public.divisions d
     where d.league_id = p_league_id
       and d.season_id = v_season
  loop
    select array_agg(dm.user_id order by dm.seat, dm.user_id)
      into v_order
      from public.division_members dm
     where dm.division_id = v_div.id;

    v_n := coalesce(array_length(v_order, 1), 0);
    continue when v_n = 0;

    v_shift := (v_next.number - 1 + coalesce(v_div.rotation_offset, 0)) % v_n;
    if v_shift > 0 then
      v_order := v_order[v_shift + 1 : v_n] || v_order[1 : v_shift];
    end if;

    insert into public.drafts
      (division_id, gameweek_id, status, pick_order, current_turn,
       picks_per_player, turn_started_at, turn_expires_at)
    values
      (v_div.id, v_next.id, 'active', v_order, 0,
       coalesce(v_league.picks_per_player, 3),
       now(),
       public.turn_deadline(v_next.id, v_n))
    on conflict (division_id, gameweek_id) do nothing;

    if found then v_created := v_created + 1; end if;
  end loop;

  update public.gameweeks set status = 'drafting'
   where id = v_next.id and status = 'upcoming';

  return jsonb_build_object(
    'opened', v_created > 0,
    'gameweek', v_next.number,
    'drafts', v_created,
    'message', format('Gameweek %s is open — %s division(s) drafting.',
                      v_next.number, v_created)
  );
end;
$$;

revoke all on function public.open_next_gameweek_for_league(uuid)
  from public, anon;
grant execute on function public.open_next_gameweek_for_league(uuid)
  to authenticated;
