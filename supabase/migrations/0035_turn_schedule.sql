-- ============================================================
--  0035 — one place that works out when a turn ends
--
--  The deadline arithmetic existed twice: turn_deadline here, and
--  turnDeadlines in src/lib/turn-windows.ts so the board could put a time
--  against seats that haven't been reached yet. The second was a mirror of
--  the first, kept in step by hand.
--
--  It has now drifted twice. 0030 moved the reserve from one hour to six
--  and added the snap to the next midday or evening; the mirror stayed on
--  the old rule, so every projected time shown to a player was too early
--  and at an hour nobody would pick. Nothing failed, which is why it went
--  unnoticed — a projection that is merely wrong looks exactly like a
--  projection.
--
--  So the whole schedule comes from here instead: the seat on the clock
--  with its real expiry, and every seat behind it with the deadline it
--  would get if the turns ahead ran their full length. Same loop as
--  turn_deadline walked forward, which is what the mirror was doing — but
--  in the one place that can also hand somebody a turn.
-- ============================================================

create or replace function public.turn_schedule(
  p_gameweek_id uuid,
  p_league_id   uuid
)
returns table (
  draft_id  uuid,
  seat      integer,
  user_id   uuid,
  due_at    timestamptz,
  projected boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_draft     record;
  v_end       timestamptz;
  v_seats     integer;
  v_prev      timestamptz;
  v_i         integer;
  v_remaining integer;
  v_share     interval;
  v_reserve   interval;
  v_latest    timestamptz;
  v_raw       timestamptz;
  v_snapped   timestamptz;
  v_at        timestamptz;
  v_stored    boolean;
begin
  v_end := public.draft_hard_deadline(p_gameweek_id);
  if v_end is null then return; end if;

  for v_draft in
    select d.id, d.pick_order, d.current_turn, d.turn_expires_at, d.status
      from public.drafts d
      join public.divisions dv on dv.id = d.division_id
     where d.gameweek_id = p_gameweek_id
       and dv.league_id  = p_league_id
  loop
    v_seats := coalesce(array_length(v_draft.pick_order, 1), 0);
    continue when v_seats = 0;

    -- The walk starts from now, the same instant turn_deadline would use
    -- if the turn were starting this second.
    v_prev := now();

    for v_i in 0 .. v_seats - 1 loop
      draft_id := v_draft.id;
      seat     := v_i;
      user_id  := v_draft.pick_order[v_i + 1];

      -- Seats that have had their turn carry no deadline; there is nothing
      -- left to be late for.
      if v_draft.status = 'complete' or v_i < v_draft.current_turn then
        due_at    := null;
        projected := false;
        return next;
        continue;
      end if;

      v_remaining := v_seats - v_i;
      v_stored := (v_i = v_draft.current_turn
                   and v_draft.turn_expires_at is not null);

      if v_stored then
        -- Only a stored expiry is a fact. Everything else is arithmetic,
        -- and says so.
        v_at := v_draft.turn_expires_at;
      elsif v_remaining <= 1 then
        v_at := v_end;
      else
        v_share   := greatest(v_end - v_prev, interval '0') / v_remaining;
        v_reserve := least(interval '6 hours', v_share);
        v_latest  := v_end - v_reserve * (v_remaining - 1);
        v_raw     := least(v_prev + v_share, v_latest);
        v_snapped := public.next_pick_slot(v_raw);
        v_at      := case when v_snapped <= v_latest then v_snapped else v_raw end;
      end if;

      due_at    := v_at;
      projected := not v_stored;
      return next;

      v_prev := v_at;
    end loop;
  end loop;
end;
$$;

revoke all on function public.turn_schedule(uuid, uuid) from public, anon;
grant execute on function public.turn_schedule(uuid, uuid) to authenticated, service_role;
