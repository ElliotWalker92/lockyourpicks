-- ============================================================
--  Lock Your Picks v2 — automatic draft opening
--
--  Until now drafts were opened by an admin pressing a button. That
--  can't run a season: every division needs its draft open the moment
--  the window starts, every week, without anyone remembering.
-- ============================================================


-- ------------------------------------------------------------
--  open_due_drafts — cron entry point
--
--  Opens drafts for every gameweek currently inside its drafting
--  window. Safe to run as often as you like: start_drafts_for_gameweek
--  upserts with ON CONFLICT DO NOTHING, so re-running is a no-op for
--  divisions that already have a draft.
--
--  Deliberately re-runs across the whole window rather than only on the
--  first tick. A division created after the window opened would
--  otherwise never get a draft for that gameweek, and the failure would
--  be silent — that player simply sees nothing to pick.
--
--  Gameweeks with no scheduled fixtures are skipped. Opening a draft on
--  a blank week would start a turn clock over an empty slate, and
--  auto_pick would then close it out with nobody having picked
--  anything.
-- ------------------------------------------------------------
create or replace function public.open_due_drafts()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_gw      record;
  v_fixtures integer;
  v_opened  integer := 0;
begin
  for v_gw in
    select id, number
      from public.gameweeks
     where draft_opens_at  <= now()
       and draft_closes_at >  now()
       and status in ('upcoming', 'drafting')
     order by number
  loop
    select count(*) into v_fixtures
      from public.fixtures
     where gameweek_id = v_gw.id
       and status      = 'scheduled'
       and kickoff_at  > now();

    if v_fixtures = 0 then
      continue;
    end if;

    v_opened := v_opened + public.start_drafts_for_gameweek(v_gw.id);
  end loop;

  return v_opened;
end;
$$;

revoke all on function public.open_due_drafts() from public, anon, authenticated;


-- ------------------------------------------------------------
--  start_drafts_for_gameweek — scoped to divisions that need one
--
--  Replaces the version in 0002, which had two problems once this runs
--  unattended:
--
--  1. It set the gameweek to 'drafting' even when it created no drafts
--     at all, which then hid the gameweek from a later run.
--  2. It looped over every division in the database on every call.
--     Harmless at nine players, wasteful at any size.
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
  if not found then
    raise exception 'Gameweek not found';
  end if;

  for v_div in
    select d.id
      from public.divisions d
     where not exists (
       select 1 from public.drafts dr
        where dr.division_id = d.id
          and dr.gameweek_id = p_gameweek_id
     )
  loop
    select array_agg(dm.user_id order by dm.user_id)
      into v_order
      from public.division_members dm
     where dm.division_id = v_div.id;

    v_n := coalesce(array_length(v_order, 1), 0);
    continue when v_n = 0;

    -- Rotate the starting player by gameweek so the first-overall pick
    -- moves through the division across the season.
    v_shift := v_gw.number % v_n;
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
         now() + (greatest(v_gw.draft_closes_at - now(), interval '0')
                  / (v_n * 3))
       ))
    on conflict (division_id, gameweek_id) do nothing;

    if found then v_created := v_created + 1; end if;
  end loop;

  -- Only advertise the gameweek as drafting if a draft actually exists.
  if v_created > 0 then
    update public.gameweeks
       set status = 'drafting'
     where id = p_gameweek_id
       and status = 'upcoming';
  end if;

  return v_created;
end;
$$;

revoke all on function public.start_drafts_for_gameweek(uuid)
  from public, anon, authenticated;
