-- ============================================================
--  0025 — a group can hold its history here before it drafts here
--
--  Betting League 26/27 is moving across from a spreadsheet mid-season.
--  Its first ten weeks go into the tables, but the group is still picking
--  in the sheet this round, and the moment a group has divisions the
--  drafts job opens the current round and starts emailing turns.
--
--  drafting_paused stops that. It's enforced by a trigger on drafts rather
--  than inside each function that creates one, so every route is covered —
--  the cron, the handover when a gameweek settles, the owner's open-next
--  button, and anything written later — without any of them needing to
--  know. A live draft for a paused group is skipped; a completed one, which
--  is what an import writes for a round already played, goes through.
--
--  Switching it off is the go-live: the next drafts pass opens the current
--  round for every division.
-- ============================================================

alter table public.leagues
  add column if not exists drafting_paused boolean not null default false;

create or replace function public.skip_draft_while_paused()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'complete' and exists (
    select 1 from public.divisions d
      join public.leagues l on l.id = d.league_id
     where d.id = new.division_id
       and l.drafting_paused
  ) then
    return null;  -- skip the row; the caller sees nothing inserted
  end if;
  return new;
end;
$$;

drop trigger if exists drafts_skip_while_paused on public.drafts;
create trigger drafts_skip_while_paused
  before insert on public.drafts
  for each row execute function public.skip_draft_while_paused();

-- Paused before it has divisions, so nothing can open in between.
update public.leagues
   set drafting_paused = true
 where id = '0927b19b-1a59-4009-87b1-2ebf3975e345';  -- Betting League 26/27

select name, drafting_paused from public.leagues;
