-- ============================================================
--  0042 — a league plays a set of competitions, not all of them
--
--  `competitions.is_active` is one global switch. Activating a European
--  competition would have put its fixtures on every league's board in the
--  next gameweek, with no way to hold it back for a group that didn't want
--  it. That is the wrong shape for what this is: the English core is the
--  game, and anything beyond it is a choice a group makes.
--
--  So membership becomes explicit. Every league holds rows saying which
--  competitions it plays, and three things make the guarantee hold without
--  anybody having to remember it:
--
--    * every existing league is backfilled with the core, so nothing
--      changes for anybody who never opts in;
--    * a trigger seeds the core into any league that is created, so a new
--      league cannot exist without it, whatever route created it;
--    * a trigger refuses to delete a core row, so "the English ones are
--      always on" is enforced by the database rather than by the one code
--      path that happens to write it today.
--
--  `is_active` keeps its meaning as the global kill switch — we are willing
--  to offer this at all — and the per-league set sits underneath it. A
--  competition is worth ingesting when it is active and either core or
--  wanted by at least one league.
--
--  What this does not change: how many picks a player gets. That follows
--  from the division size against the thinnest gameweek, and the thinnest
--  gameweek is now counted over the league's own competitions — so it is
--  counted over the core at minimum. Extras can only ever add fixtures to a
--  week, never take them away, so the arithmetic that said five players
--  taking two each needs ten fixtures still holds, and still holds for the
--  group that opts into nothing. The fixture floor was global, which would
--  have let one league's Champions League fixtures talk another league into
--  a division size its own card could not carry.
-- ============================================================

-- ------------------------------------------------------------
--  Which competitions are the game itself
-- ------------------------------------------------------------
alter table public.competitions
  add column if not exists is_core boolean not null default false;

comment on column public.competitions.is_core is
  'Part of the game for every league: cannot be turned off. The English pyramid and its two cups. Everything else is opt-in per league.';

-- Everything live today is English and mandatory, which is exactly the set
-- this is meant to name: PL, ELC, EL1, EL2, FAC, EFLC.
update public.competitions set is_core = true where is_active;


-- ------------------------------------------------------------
--  The set a league plays
-- ------------------------------------------------------------
create table if not exists public.league_competitions (
  league_id      uuid not null references public.leagues(id) on delete cascade,
  competition_id uuid not null references public.competitions(id) on delete cascade,
  added_at       timestamptz not null default now(),
  primary key (league_id, competition_id)
);

comment on table public.league_competitions is
  'Competitions a league draws its fixtures from. Core competitions are seeded on league creation and cannot be removed; the rest are the owner''s choice.';

create index if not exists league_competitions_competition
  on public.league_competitions (competition_id);

-- Every league that already exists keeps exactly what it has today.
insert into public.league_competitions (league_id, competition_id)
select l.id, c.id
  from public.leagues l
  cross join public.competitions c
 where c.is_core
on conflict do nothing;


-- ------------------------------------------------------------
--  The core is not optional
-- ------------------------------------------------------------
--
--  Seeded by trigger rather than by the create-league action, so it holds
--  for a league made by an admin script, a future invite flow, or a hand
--  insert in the SQL editor. One rule, one place.
create or replace function public.seed_league_competitions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.league_competitions (league_id, competition_id)
  select new.id, c.id from public.competitions c where c.is_core
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists leagues_seed_competitions on public.leagues;
create trigger leagues_seed_competitions
  after insert on public.leagues
  for each row execute function public.seed_league_competitions();

create or replace function public.keep_core_competitions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Referential actions run as AFTER triggers on the parent delete, so by
  -- the time a cascade reaches this row its league (or competition) is
  -- already gone. Without that test, deleting a league would raise here and
  -- leagues would be undeletable — the guard is meant to stop an owner
  -- turning the core off, not to pin the row in place forever.
  if not exists (select 1 from public.leagues l where l.id = old.league_id) then
    return old;
  end if;
  if not exists (
    select 1 from public.competitions c where c.id = old.competition_id
  ) then
    return old;
  end if;

  if exists (
    select 1 from public.competitions c
     where c.id = old.competition_id and c.is_core
  ) then
    raise exception 'The English competitions are part of the game and cannot be turned off.';
  end if;
  return old;
end;
$$;

drop trigger if exists league_competitions_keep_core on public.league_competitions;
create trigger league_competitions_keep_core
  before delete on public.league_competitions
  for each row execute function public.keep_core_competitions();


-- ------------------------------------------------------------
--  Reading it
-- ------------------------------------------------------------
alter table public.league_competitions enable row level security;

-- Anyone who can see the league can see what it plays. Writes go through
-- set_league_competitions below, so there is no write policy.
drop policy if exists "league competitions: members read"
  on public.league_competitions;
create policy "league competitions: members read"
  on public.league_competitions for select
  using (
    exists (
      select 1 from public.league_members m
       where m.league_id = league_competitions.league_id
         and m.user_id = auth.uid()
    )
    or public.is_admin()
  );


-- ------------------------------------------------------------
--  The fixture floor, per league
-- ------------------------------------------------------------
--
--  Was global. A league with Champions League fixtures on would have raised
--  the floor for every other league, and set_division_size would then have
--  allowed a size that the asking league's own fixture list cannot carry —
--  the players would simply run out of matches to take.
--
--  The old signature goes rather than staying beside this one: two
--  functions with the same name and a different idea of what counts is the
--  drift that has caused most of the bugs in this schema's history.
drop function if exists public.fixture_floor(uuid);

--  A null league means the core, which is what the create-league form needs:
--  it quotes the trade-off before there is a league to quote it for, and the
--  core is the only thing a league is guaranteed to have.
create or replace function public.fixture_floor(
  p_season    uuid,
  p_league_id uuid
)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(min(c), 0)
    from (
      select count(f.id) as c
        from public.gameweeks g
        join public.fixtures f on f.gameweek_id = g.id
        join public.competitions comp on comp.id = f.competition_id
        left join public.league_competitions lc
          on lc.competition_id = comp.id
         and lc.league_id = p_league_id
       where g.season_id = p_season
         and g.draft_closes_at > now()
         and case
               when p_league_id is null then comp.is_core
               else lc.league_id is not null
             end
       group by g.id
    ) per_gameweek;
$$;

revoke all on function public.fixture_floor(uuid, uuid) from public, anon;
grant execute on function public.fixture_floor(uuid, uuid)
  to authenticated, service_role;


-- ------------------------------------------------------------
--  set_division_size, against the league's own card
-- ------------------------------------------------------------
--
--  Same function as 0029 with one line changed: the floor is now the
--  league's, not everybody's.
create or replace function public.set_division_size(
  p_league_id uuid,
  p_division_size integer
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_league  public.leagues%rowtype;
  v_season  uuid;
  v_picks   integer;
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

  v_picks := public.picks_for_division_size(p_division_size);

  select id into v_season from public.seasons where is_active;
  v_floor := coalesce(public.fixture_floor(v_season, p_league_id), 0);

  if v_floor > 0 and p_division_size * v_picks > v_floor then
    raise exception
      '% players taking % each needs % fixtures, and the smallest gameweek left has %.',
      p_division_size, v_picks, p_division_size * v_picks, v_floor;
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
     set division_size    = p_division_size,
         picks_per_player = v_picks
   where id = p_league_id;

  return jsonb_build_object(
    'division_size', p_division_size,
    'picks_per_player', v_picks,
    'floor', v_floor
  );
end;
$$;

revoke all on function public.set_division_size(uuid, integer) from public, anon;
grant execute on function public.set_division_size(uuid, integer) to authenticated;


-- ------------------------------------------------------------
--  Choosing the extras
-- ------------------------------------------------------------
--
--  Takes the full set the owner wants, not a single toggle, so the whole
--  choice is one atomic decision rather than a sequence that can half-fail.
--  The core is added back regardless of what was passed.
--
--  Not while a draft is running. Turning a competition on mid-gameweek
--  would hand new fixtures to whoever picks next and nothing to the players
--  who have already gone, which is the one unfairness this game cannot
--  absorb. Between gameweeks the owner can change it freely.
create or replace function public.set_league_competitions(
  p_league_id uuid,
  p_competition_ids uuid[]
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_league public.leagues%rowtype;
  v_open   integer;
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

  select count(*) into v_open
    from public.drafts d
    join public.divisions dv on dv.id = d.division_id
   where dv.league_id = p_league_id
     and d.status = 'active';

  if v_open > 0 then
    raise exception
      'Picks are open for this gameweek. You can change the competitions once this round has kicked off.';
  end if;

  -- Nulls out of the array first: `x <> all (array[...])` yields null for a
  -- null element, so the delete below would silently keep every row.
  p_competition_ids := coalesce(
    (select array_agg(x) from unnest(p_competition_ids) x where x is not null),
    '{}'::uuid[]
  );

  -- Anything asked for that we are not offering is a mistake worth saying
  -- out loud rather than silently dropping.
  select array_agg(x::text) into v_codes
    from unnest(p_competition_ids) x
   where not exists (
     select 1 from public.competitions c where c.id = x and c.is_active
   );
  if v_codes is not null then
    raise exception 'Not a competition we offer: %', array_to_string(v_codes, ', ');
  end if;

  -- Core first, so the row is already there when the delete below runs and
  -- the keep-core trigger never has to fire.
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


-- ------------------------------------------------------------
--  Picking: the server decides what is pickable
-- ------------------------------------------------------------
--
--  Filtering the board in the page would have been cosmetic. make_pick
--  takes a fixture id from the client, so a fixture outside the league's
--  set has to be refused here or it is pickable by anyone who can send an
--  RPC — and auto_pick has to be told as well, or an expired turn would
--  hand somebody a fixture their league does not play.
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
  v_league     uuid;
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

  select dv.league_id into v_league
    from public.divisions dv where dv.id = v_draft.division_id;

  if not exists (
    select 1 from public.league_competitions lc
     where lc.league_id = v_league
       and lc.competition_id = v_fixture.competition_id
  ) then
    raise exception 'Your league does not play that competition';
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
  v_league  uuid;
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

  select dv.league_id into v_league
    from public.divisions dv where dv.id = v_draft.division_id;

  select count(*) into v_made
    from public.picks where draft_id = p_draft_id and user_id = v_uid;

  while v_made < v_draft.picks_per_player loop
    select f.id as fixture_id,
           (ht.elo_rating + 100 - at.elo_rating) as edge
      into v_choice
      from public.fixtures f
      join public.teams ht on ht.id = f.home_team_id
      join public.teams at on at.id = f.away_team_id
      join public.league_competitions lc
        on lc.competition_id = f.competition_id
       and lc.league_id = v_league
     where f.gameweek_id = v_draft.gameweek_id
       and f.status      = 'scheduled'
       and f.kickoff_at  > now()
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
--  What is worth ingesting
-- ------------------------------------------------------------
--
--  Active and either core or wanted by somebody. A competition nobody has
--  turned on costs provider calls for fixtures no board will ever show, and
--  the provider's per-minute ceiling is the scarcest thing this app has.
create or replace function public.competitions_in_play()
returns setof public.competitions
language sql stable security definer set search_path = public as $$
  select c.* from public.competitions c
   where c.is_active
     and (
       c.is_core
       or exists (
         select 1 from public.league_competitions lc
          where lc.competition_id = c.id
       )
     )
   order by c.is_core desc, c.tier nulls last, c.code;
$$;

revoke all on function public.competitions_in_play() from public, anon;
grant execute on function public.competitions_in_play() to authenticated, service_role;
