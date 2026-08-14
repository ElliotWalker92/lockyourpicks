-- ============================================================
--  Lock Your Picks v2 — season rollover, promotion and relegation
-- ============================================================


-- ------------------------------------------------------------
--  Move season scoping from leagues to divisions
--
--  A league is the permanent social unit: a name, a join code, a set of
--  people. It should outlive a season. Divisions are the per-season
--  arrangement of those people, and they are what promotion and
--  relegation rewrites.
--
--  With season_id on leagues, a new season meant a new league — new join
--  code, everyone re-joining, history split in two — which makes
--  promotion between seasons impossible to express.
-- ------------------------------------------------------------

alter table public.divisions
  add column if not exists season_id uuid references public.seasons(id) on delete cascade;

update public.divisions d
   set season_id = l.season_id
  from public.leagues l
 where d.league_id = l.id
   and d.season_id is null;

-- Any division with no league to inherit from predates real use.
delete from public.divisions where season_id is null;

alter table public.divisions alter column season_id set not null;

alter table public.division_members
  add column if not exists season_id uuid references public.seasons(id) on delete cascade;

update public.division_members dm
   set season_id = d.season_id
  from public.divisions d
 where dm.division_id = d.id
   and dm.season_id is null;

delete from public.division_members where season_id is null;

alter table public.division_members alter column season_id set not null;

-- A tier is unique per league *per season*, not for all time.
alter table public.divisions drop constraint if exists divisions_league_id_tier_key;
alter table public.divisions
  add constraint divisions_league_season_tier_key unique (league_id, season_id, tier);

-- Likewise a player sits in one division per league per season.
alter table public.division_members drop constraint if exists division_members_league_id_user_id_key;
alter table public.division_members
  add constraint division_members_league_season_user_key
  unique (league_id, season_id, user_id);

-- The league itself is no longer tied to a season.
alter table public.leagues drop column if exists season_id;


-- ------------------------------------------------------------
--  division_standings — ranked, with a tiebreak
--
--  The league table shows shared positions on level points, matching the
--  spreadsheet. Promotion and relegation can't do that: something has to
--  go up and something has to come down, so a tie must be broken.
--
--  Order: points, then fewest auto-picks, then earliest joined, then id.
--
--  Auto-picks as the first tiebreak rewards turning up. Two players level
--  on points aren't equally deserving if one made every pick themselves
--  and the other let the clock run out. The last two keys exist only to
--  make the result deterministic.
-- ------------------------------------------------------------
create or replace view public.division_standings
with (security_invoker = true) as
select
  dm.league_id,
  dm.season_id,
  dm.division_id,
  d.tier,
  dm.user_id,
  coalesce(sum(gs.points), 0)::integer as points,
  (
    select count(*)
      from public.picks p
      join public.drafts dr on dr.id = p.draft_id
     where p.user_id = dm.user_id
       and dr.division_id = dm.division_id
       and p.is_auto_pick
  )::integer as auto_picks,
  rank() over (
    partition by dm.division_id
    order by coalesce(sum(gs.points), 0) desc,
             (
               select count(*)
                 from public.picks p
                 join public.drafts dr on dr.id = p.draft_id
                where p.user_id = dm.user_id
                  and dr.division_id = dm.division_id
                  and p.is_auto_pick
             ) asc,
             dm.user_id
  )::integer as position
from public.division_members dm
join public.divisions d on d.id = dm.division_id
left join public.gameweek_scores gs
       on gs.user_id = dm.user_id
      and gs.division_id = dm.division_id
group by dm.league_id, dm.season_id, dm.division_id, d.tier, dm.user_id;

grant select on public.division_standings to anon, authenticated;


-- ------------------------------------------------------------
--  apply_promotion_relegation
--
--  One up, one down between adjacent tiers.
--
--  Each player is mapped independently to a new tier:
--    finished 1st and not already top tier  -> up one
--    finished last and not already bottom   -> down one
--    otherwise                              -> stay
--
--  Because every division sends exactly one up and one down (except at
--  the boundaries, where there is nowhere to go), division sizes come out
--  unchanged without any explicit balancing.
--
--  Idempotent: re-running for the same target season rebuilds it from the
--  source season rather than promoting twice.
-- ------------------------------------------------------------
create or replace function public.apply_promotion_relegation(
  p_league_id      uuid,
  p_from_season_id uuid,
  p_to_season_id   uuid
) returns integer language plpgsql security definer set search_path = public as $$
declare
  v_max_tier integer;
  v_row      record;
  v_new_tier integer;
  v_div_id   uuid;
  v_moved    integer := 0;
begin
  if p_from_season_id = p_to_season_id then
    raise exception 'Source and target season must differ';
  end if;

  select max(d.tier) into v_max_tier
    from public.divisions d
   where d.league_id = p_league_id
     and d.season_id = p_from_season_id;

  if v_max_tier is null then
    raise exception 'League has no divisions in the source season';
  end if;

  -- Rebuild the target season from scratch so a re-run is a no-op rather
  -- than a second round of promotions.
  delete from public.divisions
   where league_id = p_league_id and season_id = p_to_season_id;

  -- Mirror the source season's tier structure.
  insert into public.divisions (league_id, season_id, name, tier)
  select p_league_id, p_to_season_id, d.name, d.tier
    from public.divisions d
   where d.league_id = p_league_id
     and d.season_id = p_from_season_id;

  for v_row in
    select s.user_id, s.tier, s.position,
           count(*) over (partition by s.division_id) as division_size
      from public.division_standings s
     where s.league_id = p_league_id
       and s.season_id = p_from_season_id
  loop
    v_new_tier := v_row.tier;

    if v_row.position = 1 and v_row.tier > 1 then
      v_new_tier := v_row.tier - 1;                      -- promoted
    elsif v_row.position = v_row.division_size and v_row.tier < v_max_tier then
      v_new_tier := v_row.tier + 1;                      -- relegated
    end if;

    if v_new_tier <> v_row.tier then
      v_moved := v_moved + 1;
    end if;

    select id into v_div_id
      from public.divisions
     where league_id = p_league_id
       and season_id = p_to_season_id
       and tier      = v_new_tier;

    insert into public.division_members (division_id, user_id, league_id, season_id)
    values (v_div_id, v_row.user_id, p_league_id, p_to_season_id)
    on conflict (league_id, season_id, user_id) do update
      set division_id = excluded.division_id;
  end loop;

  return v_moved;
end;
$$;

revoke all on function public.apply_promotion_relegation(uuid, uuid, uuid)
  from public, anon, authenticated;
