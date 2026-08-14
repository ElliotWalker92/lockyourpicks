-- ============================================================
--  0013 — the open league, and a global leaderboard
--
--  Two separate things that arrive together:
--
--  1. Somewhere to play without a join code. Drafting needs an opponent
--     pool, so "no league" can't mean "no division" — solo players are
--     auto-assigned into open divisions of three and draft exactly as a
--     private league does. Exclusivity survives intact.
--
--  2. A table ranking every player in the season, whichever pool they
--     drafted in. gameweek_scores is already keyed (user_id, gameweek_id),
--     so every player has exactly one comparable score per week and the
--     ranking needs no new storage.
--
--  A player belongs to one draft pool. Three picks a week is the game;
--  scoring in two leagues would mean six, so joining a private league
--  gives up the open-league place (see leave_open_league).
-- ============================================================


-- ------------------------------------------------------------
--  The open league itself
--
--  It has no owner. Nobody should be able to rename it, re-arrange its
--  divisions by hand, or delete it, and the existing policies all key off
--  owner_id — a null owner fails every one of them closed, which is the
--  behaviour we want rather than something to work around.
-- ------------------------------------------------------------
alter table public.leagues
  add column if not exists is_open boolean not null default false;

alter table public.leagues alter column owner_id drop not null;

alter table public.leagues
  drop constraint if exists leagues_owner_required;
alter table public.leagues
  add constraint leagues_owner_required
  check (is_open or owner_id is not null);

-- One open league, ever.
create unique index if not exists leagues_single_open
  on public.leagues ((true)) where is_open;

-- The join code is deliberately unreachable: joinLeague upper-cases what
-- the user types, so a lower-case code can never be matched by hand. Entry
-- is through join_open_league() only.
insert into public.leagues (name, join_code, owner_id, division_size, is_open)
select 'The Open League', 'open-league', null, 3, true
where not exists (select 1 from public.leagues where is_open);


-- ------------------------------------------------------------
--  join_open_league — place a player in an open division
--
--  Fills the bottom division before opening a new one, so newcomers start
--  at the foot of the pyramid and climb. Serialised on an advisory lock:
--  two people taking the last seat of a division at the same moment is the
--  same race the draft itself has, and counting members outside a lock
--  would let a division of three end up with four.
-- ------------------------------------------------------------
create or replace function public.join_open_league()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_league public.leagues%rowtype;
  v_season uuid;
  v_div    uuid;
  v_tier   integer;
  v_seat   integer;
begin
  if v_user is null then
    raise exception 'You need to be signed in.';
  end if;

  select * into v_league from public.leagues where is_open;
  if not found then
    raise exception 'There is no open league configured.';
  end if;

  select id into v_season from public.seasons where is_active;
  if v_season is null then
    raise exception 'No active season.';
  end if;

  -- Already placed? Hand back the same division — this is idempotent so a
  -- double-submitted form doesn't error in the user's face.
  select dm.division_id into v_div
    from public.division_members dm
   where dm.user_id = v_user
     and dm.league_id = v_league.id
     and dm.season_id = v_season;
  if v_div is not null then
    return v_div;
  end if;

  if exists (
    select 1 from public.league_members where user_id = v_user
  ) then
    raise exception 'You are already in a league. Leave it first to play the open league.';
  end if;

  perform pg_advisory_xact_lock(hashtext('lockyourpicks:open_league_join'));

  -- Re-check under the lock: another transaction may have placed them
  -- between the check above and the lock being granted.
  select dm.division_id into v_div
    from public.division_members dm
   where dm.user_id = v_user
     and dm.league_id = v_league.id
     and dm.season_id = v_season;
  if v_div is not null then
    return v_div;
  end if;

  select d.id into v_div
    from public.divisions d
    left join public.division_members dm on dm.division_id = d.id
   where d.league_id = v_league.id
     and d.season_id = v_season
   group by d.id, d.tier
  having count(dm.user_id) < v_league.division_size
   order by d.tier desc
   limit 1;

  if v_div is null then
    select coalesce(max(d.tier), 0) + 1 into v_tier
      from public.divisions d
     where d.league_id = v_league.id
       and d.season_id = v_season;

    insert into public.divisions (league_id, season_id, name, tier)
    values (v_league.id, v_season, 'Open ' || v_tier, v_tier)
    returning id into v_div;
  end if;

  select count(*) into v_seat
    from public.division_members
   where division_id = v_div;

  insert into public.league_members (league_id, user_id)
  values (v_league.id, v_user)
  on conflict do nothing;

  insert into public.division_members (division_id, user_id, league_id, season_id, seat)
  values (v_div, v_user, v_league.id, v_season, v_seat);

  return v_div;
end;
$$;

revoke all on function public.join_open_league() from public, anon;
grant execute on function public.join_open_league() to authenticated;


-- ------------------------------------------------------------
--  leave_open_league — give up the open place, cleanly
--
--  The awkward case is leaving mid-draft. A division's pick_order is a
--  fixed array of user ids and current_turn indexes into it, so simply
--  deleting the membership would leave the draft waiting on a ghost and
--  auto-picking for somebody who is no longer in the division. The array
--  has to be repaired in the same transaction.
--
--  Points already earned in the open league are kept. They stay attached
--  to the open division, so they count on the global table but do not
--  follow the player into their new league's table.
-- ------------------------------------------------------------
create or replace function public.leave_open_league()
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_user    uuid := auth.uid();
  v_league  public.leagues%rowtype;
  v_season  uuid;
  v_div     uuid;
  v_draft   public.drafts%rowtype;
  v_order   uuid[];
  v_idx     integer;
  v_turn    integer;
  v_n       integer;
begin
  if v_user is null then
    raise exception 'You need to be signed in.';
  end if;

  select * into v_league from public.leagues where is_open;
  if not found then return false; end if;

  select id into v_season from public.seasons where is_active;
  if v_season is null then return false; end if;

  select dm.division_id into v_div
    from public.division_members dm
   where dm.user_id = v_user
     and dm.league_id = v_league.id
     and dm.season_id = v_season;

  if v_div is null then return false; end if;

  -- Repair any draft that still has them in its running order.
  for v_draft in
    select * from public.drafts
     where division_id = v_div
       and status <> 'complete'
       for update
  loop
    v_idx := array_position(v_draft.pick_order, v_user);
    continue when v_idx is null;

    delete from public.picks
     where draft_id = v_draft.id and user_id = v_user;

    v_n := array_length(v_draft.pick_order, 1);
    v_order := v_draft.pick_order[1 : v_idx - 1]
            || v_draft.pick_order[v_idx + 1 : v_n];

    -- current_turn is a 0-based index. Removing somebody ahead of the
    -- current player shifts everyone down one; removing the current player
    -- leaves the index pointing at whoever was next, which is correct.
    v_turn := v_draft.current_turn;
    if v_idx - 1 < v_draft.current_turn then
      v_turn := v_turn - 1;
    end if;

    if coalesce(array_length(v_order, 1), 0) = 0 then
      delete from public.drafts where id = v_draft.id;
    elsif v_turn >= array_length(v_order, 1) then
      update public.drafts
         set pick_order = v_order,
             current_turn = array_length(v_order, 1) - 1,
             status = 'complete',
             completed_at = now(),
             turn_expires_at = null
       where id = v_draft.id;
    else
      update public.drafts
         set pick_order = v_order,
             current_turn = v_turn,
             turn_started_at = case
               when v_idx - 1 = v_draft.current_turn then now()
               else turn_started_at end,
             turn_expires_at = case
               when v_idx - 1 = v_draft.current_turn then turn_expires_at
               else turn_expires_at end
       where id = v_draft.id;
    end if;
  end loop;

  delete from public.division_members
   where user_id = v_user and division_id = v_div;

  delete from public.league_members
   where user_id = v_user and league_id = v_league.id;

  return true;
end;
$$;

revoke all on function public.leave_open_league() from public, anon;
grant execute on function public.leave_open_league() to authenticated;


-- ------------------------------------------------------------
--  global_standings — every player in the season, ranked
--
--  Deliberately not scoped to a league. Everyone gets three picks a week
--  worth a point each, so totals are comparable across pools even though
--  the fixtures available to each player were not the same.
--
--  Ranked with rank(), so level scores share a position, matching how the
--  league tables read. No tiebreak is applied: nothing is promoted or
--  relegated off this table, so there is nothing a tie needs to resolve.
-- ------------------------------------------------------------
create or replace view public.global_standings
with (security_invoker = true) as
select
  gw.season_id,
  gs.user_id,
  sum(gs.points)::integer          as points,
  count(*)::integer                as gameweeks_played,
  sum(gs.correct_count)::integer   as correct_count,
  bool_or(l.is_open)               as plays_open,
  rank() over (
    partition by gw.season_id
    order by sum(gs.points) desc
  )::integer                       as position
from public.gameweek_scores gs
join public.gameweeks gw   on gw.id = gs.gameweek_id
join public.divisions d    on d.id = gs.division_id
join public.leagues l      on l.id = d.league_id
group by gw.season_id, gs.user_id;

grant select on public.global_standings to anon, authenticated;
