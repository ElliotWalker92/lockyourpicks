-- ============================================================
--  0038 — give the new season a running order
--
--  apply_promotion_relegation rebuilds next season's divisions and places
--  everybody in them, but never sets a seat. Every player arrives on the
--  default, zero.
--
--  Seat is what orders a draft: start_drafts_for_gameweek builds pick_order
--  with `order by dm.seat, dm.user_id`. All seats equal, that falls through
--  to the user id — so next season's running order would be the order of
--  some UUIDs. Nothing would error and nothing would look broken; the
--  rotation would turn an arrangement nobody chose, and there would be no
--  way to say who starts.
--
--  Found by running the thing against a throwaway season rather than
--  waiting for May, which is the only way this surfaces: it has no symptom
--  until the first draft of a season that hasn't happened yet.
--
--  Seated by where they finished: division first, then position in it. The
--  team that won the division above you seats ahead of the one that won
--  yours. It only decides who starts in gameweek one — the order rotates
--  every week after — but it should be a decision rather than an accident.
-- ============================================================

create or replace function public.apply_promotion_relegation(
  p_league_id      uuid,
  p_from_season_id uuid,
  p_to_season_id   uuid
)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_row      record;
  v_new_tier integer;
  v_max_tier integer;
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

  delete from public.divisions
   where league_id = p_league_id and season_id = p_to_season_id;

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
      v_new_tier := v_row.tier - 1;
    elsif v_row.position = v_row.division_size and v_row.tier < v_max_tier then
      v_new_tier := v_row.tier + 1;
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

  -- ---- The running order ----
  --
  -- Done after the loop rather than inside it, because a seat is a position
  -- among the others in the division and nobody knows who those are until
  -- everybody has been placed.
  with ranked as (
    select dm.user_id,
           dm.division_id,
           row_number() over (
             partition by dm.division_id
             order by s.tier, s.position, dm.user_id
           ) as seat
      from public.division_members dm
      join public.division_standings s
        on s.user_id   = dm.user_id
       and s.league_id = p_league_id
       and s.season_id = p_from_season_id
     where dm.league_id = p_league_id
       and dm.season_id = p_to_season_id
  )
  update public.division_members dm
     set seat = r.seat
    from ranked r
   where dm.user_id     = r.user_id
     and dm.division_id = r.division_id
     and dm.season_id   = p_to_season_id;

  return v_moved;
end;
$$;

revoke all on function public.apply_promotion_relegation(uuid, uuid, uuid)
  from public, anon;
