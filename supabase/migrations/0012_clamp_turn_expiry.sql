-- ============================================================
--  Lock Your Picks v2 — a turn can never outlive the deadline
--
--  start_drafts_for_gameweek and advance_draft_turn both wrap the new
--  expiry in least(draft_closes_at, …), so the arithmetic was already
--  right. But it was only a convention: anything writing to drafts
--  directly could set a turn to expire after the first kickoff, and
--  nothing would object.
--
--  That is exactly what happened — a turn was extended by hand for
--  testing and ended up 3.5 hours past the deadline, showing players a
--  countdown that promised time the gameweek did not have.
--
--  A trigger makes it an invariant of the table rather than a habit of
--  the two functions that happen to respect it.
-- ============================================================

create or replace function public.clamp_turn_expiry()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_closes timestamptz;
begin
  if new.turn_expires_at is null then
    return new;
  end if;

  select draft_closes_at into v_closes
    from public.gameweeks where id = new.gameweek_id;

  if v_closes is not null and new.turn_expires_at > v_closes then
    new.turn_expires_at := v_closes;
  end if;

  return new;
end;
$$;

drop trigger if exists drafts_clamp_turn_expiry on public.drafts;

create trigger drafts_clamp_turn_expiry
  before insert or update on public.drafts
  for each row execute function public.clamp_turn_expiry();


-- Repair anything already past its deadline.
update public.drafts d
   set turn_expires_at = g.draft_closes_at
  from public.gameweeks g
 where d.gameweek_id = g.id
   and d.turn_expires_at is not null
   and d.turn_expires_at > g.draft_closes_at;
