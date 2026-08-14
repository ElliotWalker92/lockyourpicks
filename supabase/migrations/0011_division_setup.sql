-- ============================================================
--  Lock Your Picks v2 — the owner arranges divisions
--
--  Until now the owner had no say in any of it:
--    * players were dealt into divisions in join order
--    * divisions were named "Division 1", "Division 2", …
--    * pick order came from `order by dm.user_id`, which is a UUID —
--      so who went first was arbitrary and unexplainable
--
--  `seat` makes the running order explicit and owner-controlled. The
--  gameweek rotation still applies on top: seat 1 starts gameweek 1,
--  seat 2 starts gameweek 2, and so on.
-- ============================================================

alter table public.division_members
  add column if not exists seat integer;

-- Backfill deterministically so existing drafts keep the order they had.
with ordered as (
  select division_id, user_id,
         row_number() over (partition by division_id order by user_id) - 1 as n
    from public.division_members
)
update public.division_members dm
   set seat = ordered.n
  from ordered
 where dm.division_id = ordered.division_id
   and dm.user_id     = ordered.user_id
   and dm.seat is null;

alter table public.division_members alter column seat set default 0;
alter table public.division_members alter column seat set not null;


-- ------------------------------------------------------------
--  start_drafts_for_gameweek — order by seat, not by user id
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
    -- seat is the owner's running order; user_id only breaks ties.
    select array_agg(dm.user_id order by dm.seat, dm.user_id)
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

revoke all on function public.start_drafts_for_gameweek(uuid)
  from public, anon, authenticated;
