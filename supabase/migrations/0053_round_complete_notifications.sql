-- ============================================================
--  0053 — telling whoever runs a league that the round is in
--
--  The person who runs a group is the one who wants to know a gameweek
--  has finished drafting: it's when the card is worth sharing, and when
--  chasing anybody stops being necessary. Until now the only way to find
--  out was to open the board and count.
--
--  "All the picks are in" is a fact about a league and a gameweek
--  together, and nothing in the schema is that pair — drafts are per
--  division, and a gameweek belongs to the season rather than to any one
--  group. So this gets a table of its own, holding only what was sent.
-- ============================================================

-- The owner's switch. On by default, like the turn email: somebody who
-- runs a group almost certainly wants this, and the ones who don't can
-- find it in the same place as the other one.
alter table public.profiles
  add column if not exists notify_round_complete boolean not null default true;

comment on column public.profiles.notify_round_complete is
  'Tell me when every pick is in for a gameweek, in a league I own.';

create table if not exists public.round_notifications (
  league_id   uuid not null references public.leagues(id)   on delete cascade,
  gameweek_id uuid not null references public.gameweeks(id) on delete cascade,
  notified_at timestamptz not null default now(),
  primary key (league_id, gameweek_id)
);

comment on table public.round_notifications is
  'One row per league-gameweek the owner has been told about. Presence is the whole fact; there is nothing to clear, because a round is only in once.';

alter table public.round_notifications enable row level security;
-- No policy: this is cron bookkeeping, read and written by the service
-- role alone. Nobody signed in has any business reading it.


-- ------------------------------------------------------------
--  Is this round in?
-- ------------------------------------------------------------
--
--  Counting complete drafts is not enough, and the reason is 0022: a
--  division may only hold one live draft at a time, so a division still
--  finishing last week has no row for this week *at all*. Asked as "are
--  all the drafts for this gameweek complete", a league whose second
--  division is a week behind answers yes while that division hasn't
--  started — and the owner is told the round is in before half of it has
--  been played.
--
--  So the question is asked from the divisions' side: every division with
--  anybody in it must have a complete draft for this gameweek. A division
--  nobody has joined is skipped, because start_drafts_for_gameweek skips
--  it too and it would otherwise hold every round open forever.
--
--  One function rather than the same predicate written into both the
--  query and the backfill below, which is how two copies of a rule start
--  disagreeing about what a finished round is.
create or replace function public.round_is_in(
  p_league_id   uuid,
  p_gameweek_id uuid
)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
           select 1
             from public.drafts d
             join public.divisions dv on dv.id = d.division_id
            where dv.league_id  = p_league_id
              and d.gameweek_id = p_gameweek_id
         )
     and not exists (
           select 1
             from public.divisions dv
            where dv.league_id = p_league_id
              and exists (
                    select 1
                      from public.division_members dm
                     where dm.division_id = dv.id
                  )
              and not exists (
                    select 1
                      from public.drafts d
                     where d.division_id  = dv.id
                       and d.gameweek_id  = p_gameweek_id
                       and d.status       = 'complete'
                  )
         );
$$;

revoke all on function public.round_is_in(uuid, uuid)
  from public, anon, authenticated;


-- ------------------------------------------------------------
--  Rounds that are in, and whose owner hasn't heard
-- ------------------------------------------------------------
--
--  The window is a limit on work, not on correctness: every round that
--  was already in when this migration ran is stamped below, so the only
--  thing the window could lose is a round that finished while the cron
--  was down for a week.
--
--  `having` rather than a `where` on completed_at, so a round whose
--  first division finished ten days ago and whose last finished this
--  morning still counts every division in its totals.
create or replace function public.pending_round_notifications()
returns table (
  league_id    uuid,
  gameweek_id  uuid,
  league_name  text,
  gameweek     integer,
  email        text,
  display_name text,
  divisions    integer,
  players      integer,
  push_targets jsonb
)
language sql security definer set search_path = public as $$
  with rounds as (
    select dv.league_id,
           d.gameweek_id,
           count(*)::integer as divisions,
           sum(coalesce(array_length(d.pick_order, 1), 0))::integer as players
      from public.drafts d
      join public.divisions dv on dv.id = d.division_id
     where d.status = 'complete'
     group by dv.league_id, d.gameweek_id
    having max(d.completed_at) > now() - interval '7 days'
  )
  select r.league_id,
         r.gameweek_id,
         l.name,
         g.number,
         p.email,
         p.display_name,
         r.divisions,
         r.players,
         coalesce(
           (select jsonb_agg(
                     jsonb_build_object(
                       'id', s.id,
                       'endpoint', s.endpoint,
                       'p256dh', s.p256dh,
                       'auth', s.auth
                     ) order by s.created_at)
              from public.push_subscriptions s
             where s.user_id = p.id),
           '[]'::jsonb
         ) as push_targets
    from rounds r
    join public.leagues   l on l.id = r.league_id
    join public.gameweeks g on g.id = r.gameweek_id
    join public.profiles  p on p.id = l.owner_id
   where p.notify_round_complete
     and p.email is not null
     and not exists (
           select 1
             from public.round_notifications n
            where n.league_id   = r.league_id
              and n.gameweek_id = r.gameweek_id
         )
     and public.round_is_in(r.league_id, r.gameweek_id)
   order by g.number;
$$;

revoke all on function public.pending_round_notifications()
  from public, anon, authenticated;

create or replace function public.mark_round_notified(
  p_league_id   uuid,
  p_gameweek_id uuid
)
returns void language sql security definer set search_path = public as $$
  insert into public.round_notifications (league_id, gameweek_id)
  values (p_league_id, p_gameweek_id)
  on conflict (league_id, gameweek_id) do nothing;
$$;

revoke all on function public.mark_round_notified(uuid, uuid)
  from public, anon, authenticated;


-- ------------------------------------------------------------
--  Everything already finished counts as told
-- ------------------------------------------------------------
--
--  Without this the first run mails the owner about every round of the
--  season at once, the imported historic ones included. A round still
--  being drafted is deliberately left unstamped, so the one in progress
--  now is the first that actually sends.
--
--  The one thing this gets wrong: a league whose second division is a
--  week behind has that older gameweek stamped as told, so when the
--  division catches up no mail goes out for it. One round, once, at the
--  moment this is applied.
insert into public.round_notifications (league_id, gameweek_id, notified_at)
select dv.league_id, d.gameweek_id, now()
  from public.drafts d
  join public.divisions dv on dv.id = d.division_id
 group by dv.league_id, d.gameweek_id
having public.round_is_in(dv.league_id, d.gameweek_id)
    on conflict (league_id, gameweek_id) do nothing;
