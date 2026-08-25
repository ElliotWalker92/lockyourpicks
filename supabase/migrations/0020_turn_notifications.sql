-- ============================================================
--  0020 — telling somebody it's their turn
--
--  The draft is asynchronous: a turn can open at four in the afternoon
--  while you're at work, and the only way to find out was to go and look.
--  A player who never looks gets auto-picked, which is the mechanism
--  working but not the game being played.
--
--  Two columns, no new table. What's needed is "have we told them about
--  *this* turn", which is a fact about the turn, and the turn already has
--  a row.
-- ============================================================

alter table public.drafts
  add column if not exists turn_notified_at timestamptz;

comment on column public.drafts.turn_notified_at is
  'When the player currently on the clock was emailed. Cleared implicitly by comparing against turn_started_at, so each new turn notifies once.';

-- Opt-out lives on the profile: it's a standing preference, not a
-- per-gameweek one.
alter table public.profiles
  add column if not exists notify_turn boolean not null default true;

comment on column public.profiles.notify_turn is
  'Email me when it is my turn to draft.';

/**
 * Turns that are waiting on someone who hasn't been told yet.
 *
 * A turn counts as un-notified when it has never been stamped, or was
 * stamped before the current turn started — which is what makes the
 * comparison, rather than a flag, do the resetting.
 */
create or replace function public.pending_turn_notifications()
returns table (
  draft_id      uuid,
  user_id       uuid,
  email         text,
  display_name  text,
  division_name text,
  league_name   text,
  gameweek      integer,
  expires_at    timestamptz
)
language sql security definer set search_path = public as $$
  select
    d.id,
    public.draft_user_at_turn(d.pick_order, d.current_turn) as user_id,
    p.email,
    p.display_name,
    dv.name,
    l.name,
    g.number,
    d.turn_expires_at
  from public.drafts d
  join public.divisions dv on dv.id = d.division_id
  join public.leagues   l  on l.id  = dv.league_id
  join public.gameweeks g  on g.id  = d.gameweek_id
  join public.profiles  p
    on p.id = public.draft_user_at_turn(d.pick_order, d.current_turn)
  where d.status = 'active'
    and d.turn_started_at is not null
    and (d.turn_notified_at is null or d.turn_notified_at < d.turn_started_at)
    and (d.turn_expires_at is null or d.turn_expires_at > now())
    and g.draft_closes_at > now()
    and p.notify_turn
    and p.email is not null;
$$;

revoke all on function public.pending_turn_notifications()
  from public, anon, authenticated;

create or replace function public.mark_turn_notified(p_draft_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.drafts set turn_notified_at = now() where id = p_draft_id;
$$;

revoke all on function public.mark_turn_notified(uuid)
  from public, anon, authenticated;
