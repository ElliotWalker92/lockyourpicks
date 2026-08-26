-- ============================================================
--  0023 — watching a group without playing in it
--
--  Being in a group and playing in it were the same thing: a
--  league_members row got you into the group, and the owner's
--  arrangement then put every one of those rows into a division. There
--  was no way to follow a group you aren't competing in — which is
--  exactly what the person running the thing wants, so they can see it
--  working without taking a place off somebody.
--
--  The access half of this already works and needs nothing:
--  shares_league_with_division, which gates every read of drafts and
--  picks, keys off league_members rather than division_members. A member
--  who never drafts can already see the group's picks. What was missing
--  was a way to say so — and, more to the point, a way to stop
--  buildDivisions sweeping them into a division along with everyone else.
--
--  Deliberately a column on league_members rather than a separate table.
--  A viewer is a kind of membership, not a different relationship, and
--  the day somebody wants to stop watching and start playing it should
--  be an update rather than a migration between two tables.
-- ============================================================

alter table public.league_members
  add column if not exists role text not null default 'player';

alter table public.league_members
  drop constraint if exists league_members_role_valid;
alter table public.league_members
  add constraint league_members_role_valid check (role in ('player', 'viewer'));

comment on column public.league_members.role is
  'player = drafts and is ranked; viewer = reads the group but is never put in a division.';


-- ------------------------------------------------------------
--  A viewer must never end up in a division
-- ------------------------------------------------------------
--
--  buildDivisions is a server action and already filters on this, but the
--  action is not the only way a row can get here — the admin functions
--  and any future import write division_members directly. The rule
--  belongs next to the data.
create or replace function public.reject_viewer_in_division()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.league_members lm
     where lm.league_id = new.league_id
       and lm.user_id   = new.user_id
       and lm.role      = 'viewer'
  ) then
    raise exception
      'That member is a viewer of this group and cannot be put in a division.';
  end if;
  return new;
end;
$$;

drop trigger if exists division_members_reject_viewer on public.division_members;
create trigger division_members_reject_viewer
  before insert or update on public.division_members
  for each row execute function public.reject_viewer_in_division();
