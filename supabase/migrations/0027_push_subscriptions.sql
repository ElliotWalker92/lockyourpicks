-- ============================================================
--  0027 — push notifications
--
--  A turn email went to junk and the player it was for didn't know he was
--  on the clock. Push can't be filtered to a spam folder, doesn't depend
--  on a sending domain's reputation, and arrives in seconds.
--
--  One row per device, not per player: the same person installs the app
--  on a phone and a tablet and expects both to buzz. The endpoint the push
--  service gives us is the identity — it is already unique per device per
--  site, and it is what we post to — so it carries the unique constraint
--  and a re-subscribe on the same device updates rather than duplicating.
--
--  The keys are the device's, not ours: p256dh is its public key and auth
--  a shared secret, both used to encrypt each message so the push service
--  carrying it can't read it.
-- ============================================================

create table if not exists public.push_subscriptions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  -- Which device this is, for a profile page that has to tell them apart.
  label       text,
  created_at  timestamptz not null default now(),
  -- Only for telling a silent device from one that was never written to.
  -- There is no failure count: a push service answers 404 or 410 when a
  -- subscription is dead and those rows are deleted outright, and any other
  -- failure is simply retried, so a counter would have no reader.
  last_sent_at timestamptz
);

create index if not exists push_subscriptions_user
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Your own devices, and only ever your own. Sending happens with the
-- service role, which bypasses these.
drop policy if exists "push: read own" on public.push_subscriptions;
create policy "push: read own"
  on public.push_subscriptions for select
  using (user_id = auth.uid());

drop policy if exists "push: remove own" on public.push_subscriptions;
create policy "push: remove own"
  on public.push_subscriptions for delete
  using (user_id = auth.uid());


-- ------------------------------------------------------------
--  Registering a device
-- ------------------------------------------------------------
--
--  Through a function rather than an upsert, because of the one case an
--  upsert can't handle: the endpoint identifies the browser, not the
--  account, so a phone that signed out and in as somebody else arrives
--  with an endpoint already on another player's row. RLS rightly won't let
--  the new player overwrite it, so the upsert fails and that device can
--  never turn notifications on. Here the old row is cleared first — the
--  device genuinely isn't that player's any more.
--
--  There is no insert or update policy to go with this; registering goes
--  through here, and reading and deleting stay open so the profile page
--  can manage its own rows.
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text,
  p_label    text default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  delete from public.push_subscriptions
   where endpoint = p_endpoint and user_id <> auth.uid();

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, label)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_label)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth   = excluded.auth,
        label  = excluded.label;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text)
  from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text)
  to authenticated;


-- ------------------------------------------------------------
--  Who to notify, and how
-- ------------------------------------------------------------
--
--  pending_turn_notifications already answers "whose turn has just started
--  and hasn't been told". It gains the player's devices, so the job can
--  push to their phone and fall back to email only when they have none —
--  rather than doing both and making the app the thing that nags twice.
--
--  The devices come back with the turn rather than from a second call per
--  player. A Worker on the free plan gets fifty subrequests per
--  invocation and every PostgREST call spends one; nine players asking
--  separately would spend nine for information one query already has.
--
--  One change to the filter: a device is an opt-in of its own, so
--  registering one counts as asking to be told and a player who switched
--  the email off and push on is still notified. Everything else about who
--  qualifies is unchanged, including not chasing a turn whose window has
--  already lapsed — that player is waiting on the auto-pick, and telling
--  them they are on the clock would be telling them something untrue.
--
--  Dropped rather than replaced: a new column in RETURNS TABLE is a change
--  of return type, which CREATE OR REPLACE refuses outright.
drop function if exists public.pending_turn_notifications();

create function public.pending_turn_notifications()
returns table (
  draft_id      uuid,
  user_id       uuid,
  email         text,
  display_name  text,
  division_name text,
  league_name   text,
  gameweek      integer,
  expires_at    timestamptz,
  push_targets  jsonb
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
    d.turn_expires_at,
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
    and p.email is not null
    and (
      p.notify_turn
      or exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
    );
$$;

revoke all on function public.pending_turn_notifications()
  from public, anon, authenticated;
