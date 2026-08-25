-- ============================================================
--  0015 — turn windows that end before the football starts
--
--  Two problems with the old arithmetic.
--
--  The last player's turn ran to draft_closes_at, which *is* the first
--  kickoff. Locking a pick in as the whistle goes is not a deadline
--  anybody should be asked to hit, and a clock that reads 00:00:00 at
--  kickoff invites exactly that. The hard deadline is now five minutes
--  before.
--
--  Second, an even split of the remaining time is only fair while there
--  is enough of it. With three players and a two-hour window, an even
--  split hands everyone forty minutes — but the first player finishing
--  at their deadline leaves the last one nothing but the tail. Each turn
--  is now also capped so that every player still to come keeps at least
--  an hour. Where the window is too short to promise even that, the cap
--  is dropped rather than pushing a deadline into the past: an even
--  split of a bad window beats an impossible one.
-- ============================================================

/** The moment picks must be in: five minutes before the first kickoff. */
create or replace function public.draft_hard_deadline(p_gameweek_id uuid)
returns timestamptz language sql stable set search_path = public as $$
  select draft_closes_at - interval '5 minutes'
    from public.gameweeks where id = p_gameweek_id;
$$;

/**
 * When the turn currently in progress should expire.
 *
 * p_remaining counts the seats still to take a turn, including this one.
 */
create or replace function public.turn_deadline(
  p_gameweek_id uuid,
  p_remaining   integer
)
returns timestamptz language plpgsql stable set search_path = public as $$
declare
  v_end       timestamptz := public.draft_hard_deadline(p_gameweek_id);
  v_available interval;
  v_share     interval;
  v_reserve   interval;
begin
  if v_end is null then return null; end if;
  if p_remaining is null or p_remaining <= 1 then return v_end; end if;

  v_available := greatest(v_end - now(), interval '0');
  v_share     := v_available / p_remaining;

  -- What to hold back for each player still waiting behind this one: an
  -- hour where the window allows it, an equal share of a short window
  -- where it doesn't. Scaling the reservation rather than switching it
  -- off keeps the deadlines in order — an earlier seat can never be
  -- handed a later deadline than the seat behind it.
  v_reserve := least(interval '1 hour', v_share);

  return least(
    v_end - v_reserve * (p_remaining - 1),
    now() + v_share
  );
end;
$$;

revoke all on function public.draft_hard_deadline(uuid) from public, anon, authenticated;
revoke all on function public.turn_deadline(uuid, integer) from public, anon, authenticated;


-- ------------------------------------------------------------
--  advance_draft_turn — same rule when the turn passes on
-- ------------------------------------------------------------
create or replace function public.advance_draft_turn(p_draft_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_draft     public.drafts%rowtype;
  v_total     integer;
  v_remaining integer;
begin
  select * into v_draft from public.drafts where id = p_draft_id for update;
  if not found then
    raise exception 'Draft % not found', p_draft_id;
  end if;

  v_total := array_length(v_draft.pick_order, 1);

  if v_draft.current_turn + 1 >= v_total then
    update public.drafts
       set status = 'complete', current_turn = v_total,
           turn_started_at = null, turn_expires_at = null, completed_at = now()
     where id = p_draft_id;
    return;
  end if;

  v_remaining := v_total - (v_draft.current_turn + 1);

  update public.drafts
     set current_turn    = v_draft.current_turn + 1,
         turn_started_at = now(),
         turn_expires_at = public.turn_deadline(v_draft.gameweek_id, v_remaining)
   where id = p_draft_id;
end;
$$;

revoke all on function public.advance_draft_turn(uuid)
  from public, anon, authenticated;


-- ------------------------------------------------------------
--  start_drafts_for_gameweek — first turn uses the same rule
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


-- ------------------------------------------------------------
--  The invariant moves with the deadline
-- ------------------------------------------------------------
create or replace function public.clamp_turn_expiry()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_end timestamptz;
begin
  if new.turn_expires_at is null then
    return new;
  end if;

  v_end := public.draft_hard_deadline(new.gameweek_id);

  if v_end is not null and new.turn_expires_at > v_end then
    new.turn_expires_at := v_end;
  end if;

  return new;
end;
$$;

-- Pull anything already promising time past the new deadline back to it.
update public.drafts d
   set turn_expires_at = g.draft_closes_at - interval '5 minutes'
  from public.gameweeks g
 where d.gameweek_id = g.id
   and d.turn_expires_at is not null
   and d.turn_expires_at > g.draft_closes_at - interval '5 minutes';
