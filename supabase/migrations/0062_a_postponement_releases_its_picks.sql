-- ============================================================
--  A postponement releases its picks, whoever wrote it
--
--  0059 released the picks on a fixture an admin called off, and 0060
--  told the players. Both hang off the admin's click, which turns out to
--  be the rarer half of the problem: the provider found three more
--  postponements in gameweek 23 by itself, and one of them —
--  Doncaster v Leyton Orient — had a pick on it. The pick stayed where
--  it was for thirty-three hours. Nothing released it, nothing told the
--  player, and settlement scores a pick on a postponed fixture zero
--  (0005), so he was down to two picks out of three without being told
--  why. The admin panel could not help either: it toggles on the current
--  status, so for a fixture that is already off it offers to put it back.
--
--  So the rule moves to the row, like the override in 0061. A fixture
--  that goes off releases the picks on it, and it does not matter whether
--  the write came from an admin, the nightly ingest, or a hand on the SQL
--  console at midnight.
--
--  A trigger cannot send mail, so it writes down who to tell instead.
--  `pick_releases` is that list: a row per released pick, stamped when
--  somebody has been told. The admin action claims the rows it caused and
--  sends immediately, because an admin watching the panel should see who
--  was affected; the ten-minute pass picks up everything else, which is
--  every release nobody was sitting in front of.
--
--  The third part is the one that closes the loop. A released player is
--  short with their turn gone, and `auto_pick` only ever fills the seat on
--  the clock in an active draft — so a player who never reads the mail
--  used to go into the weekend a pick down. `auto_pick_shortfalls` fills
--  anyone still short once picking has closed, which is the same promise
--  the draft already makes about a missed turn.
-- ============================================================

-- ------------------------------------------------------------
--  Who to tell
-- ------------------------------------------------------------
create table if not exists public.pick_releases (
  id          uuid primary key default gen_random_uuid(),
  draft_id    uuid not null references public.drafts(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  fixture_id  uuid not null references public.fixtures(id) on delete cascade,
  outcome     public.outcome not null,
  released_at timestamptz not null default now(),
  notified_at timestamptz
);

comment on table public.pick_releases is
  'One row per pick given back because its fixture went off. Written by '
  'the trigger that releases it, cleared by whoever tells the player. A '
  'trigger cannot send mail, so it leaves a note instead.';

create index if not exists pick_releases_unnotified
  on public.pick_releases (released_at)
  where notified_at is null;

alter table public.pick_releases enable row level security;

-- Nobody reads this table directly. The player learns through the
-- notification and sees the gap on their own slip; the admin action and
-- the cron reach it through the functions below, which are
-- security definer.
revoke all on table public.pick_releases from anon, authenticated;


-- ------------------------------------------------------------
--  The release itself
--
--  Only rounds still open. A closed round is history: reopening it would
--  rewrite a settled table, and the player could not pick again anyway,
--  so there is nothing to give back and nothing to say.
-- ------------------------------------------------------------
create or replace function public.release_picks_on_fixture(p_fixture_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_released integer;
begin
  with gone as (
    delete from public.picks p
     using public.drafts d, public.gameweeks g
     where p.fixture_id = p_fixture_id
       and d.id = p.draft_id
       and g.id = d.gameweek_id
       and g.draft_closes_at > now()
    returning p.draft_id, p.user_id, p.fixture_id, p.predicted_outcome
  )
  insert into public.pick_releases (draft_id, user_id, fixture_id, outcome)
  select draft_id, user_id, fixture_id, predicted_outcome from gone;

  get diagnostics v_released = row_count;
  return v_released;
end;
$$;

revoke all on function public.release_picks_on_fixture(uuid) from public, anon, authenticated;


create or replace function public.fixture_off_releases_picks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- The final status, after 0061's guard has had its say. When that guard
  -- reverts a feed's change, NEW.status comes back equal to OLD.status and
  -- this does nothing — which is right, because nothing moved.
  if NEW.status in ('postponed', 'cancelled')
     and NEW.status is distinct from OLD.status then
    perform public.release_picks_on_fixture(NEW.id);
  end if;
  return null;
end;
$$;

drop trigger if exists fixtures_off_releases_picks on public.fixtures;
create trigger fixtures_off_releases_picks
  after update of status on public.fixtures
  for each row execute procedure public.fixture_off_releases_picks();


-- ------------------------------------------------------------
--  admin_set_fixture_status, now that the release is not its job
--
--  It keeps returning who was affected, because an admin who has just
--  taken a game off the board needs to see whose round it changed. The
--  rows come from the outbox the trigger has just written rather than
--  from its own delete, so there is one copy of the releasing rule.
-- ------------------------------------------------------------
create or replace function public.admin_set_fixture_status(
  p_fixture_id uuid,
  p_status     public.fixture_status
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_players jsonb := '[]'::jsonb;
  v_ids     uuid[] := '{}';
  v_label   text;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;

  if p_status not in ('scheduled', 'postponed', 'cancelled') then
    raise exception 'Use this for scheduled, postponed or cancelled only, not %',
      p_status;
  end if;

  select coalesce(h.name, '?') || ' v ' || coalesce(a.name, '?')
    into v_label
    from public.fixtures f
    left join public.teams h on h.id = f.home_team_id
    left join public.teams a on a.id = f.away_team_id
   where f.id = p_fixture_id;

  if v_label is null then
    raise exception 'Fixture not found';
  end if;

  -- Tells 0061's guard this one is deliberate, and takes it back straight
  -- after: the setting is transaction-local, and leaving it raised would
  -- wave through anything else writing a status later in the same
  -- transaction.
  perform set_config('app.fixture_admin', 'on', true);

  update public.fixtures
     set status          = p_status,
         -- Putting a fixture back hands it to the provider again, which is
         -- what you want when a postponement is reversed or was a mistake.
         status_override = (p_status <> 'scheduled'),
         updated_at      = now()
   where id = p_fixture_id;

  perform set_config('app.fixture_admin', '', true);

  -- Anything still unsaid about this fixture, which is what this click
  -- just caused plus anything an earlier release failed to send.
  select coalesce(array_agg(r.id), '{}') into v_ids
    from public.pick_releases r
   where r.fixture_id = p_fixture_id
     and r.notified_at is null;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'release_ids', ids,
               'user_id', pr.id,
               'display_name', pr.display_name,
               'push_targets', coalesce(
                 (select jsonb_agg(
                           jsonb_build_object(
                             'id', s.id, 'endpoint', s.endpoint,
                             'p256dh', s.p256dh, 'auth', s.auth
                           ) order by s.created_at)
                    from public.push_subscriptions s
                   where s.user_id = pr.id),
                 '[]'::jsonb
               )
             )
           ),
           '[]'::jsonb
         )
    into v_players
    from (
      select r.user_id, jsonb_agg(r.id) as ids
        from public.pick_releases r
       where r.id = any (v_ids)
       group by r.user_id
    ) g
    join public.profiles pr on pr.id = g.user_id;

  return jsonb_build_object(
    'fixture',  v_label,
    'released', coalesce(array_length(v_ids, 1), 0),
    'players',  v_players
  );
end;
$$;

revoke all     on function public.admin_set_fixture_status(uuid, public.fixture_status) from public, anon;
grant  execute on function public.admin_set_fixture_status(uuid, public.fixture_status) to authenticated;

comment on function public.admin_set_fixture_status(uuid, public.fixture_status) is
  'Admin-only. Sets a fixture''s status. The release of any picks on it is '
  'the trigger''s job now, so this reports what that release affected and '
  'leaves the sending to its caller. Never returns an email address — see '
  'migration 0057.';


-- ------------------------------------------------------------
--  What the ten-minute pass has left to say
-- ------------------------------------------------------------
create or replace function public.pending_pick_releases()
returns table (
  user_id      uuid,
  display_name text,
  email        text,
  release_ids  uuid[],
  fixtures     text[],
  short        integer,
  gameweek     integer,
  closes_at    timestamptz,
  push_targets jsonb
)
language sql security definer set search_path = public as $$
  select pr.id,
         pr.display_name,
         pr.email,
         array_agg(r.id),
         array_agg(coalesce(h.name, '?') || ' v ' || coalesce(a.name, '?')),
         -- What they are actually short, not how many were released: they
         -- may have replaced one already, and a mail saying two when one
         -- is missing is worse than no mail.
         (d.picks_per_player - (
            select count(*) from public.picks p
             where p.draft_id = r.draft_id and p.user_id = r.user_id
          ))::integer,
         g.number,
         g.draft_closes_at,
         coalesce(
           (select jsonb_agg(
                     jsonb_build_object(
                       'id', s.id, 'endpoint', s.endpoint,
                       'p256dh', s.p256dh, 'auth', s.auth
                     ) order by s.created_at)
              from public.push_subscriptions s
             where s.user_id = pr.id),
           '[]'::jsonb
         )
    from public.pick_releases r
    join public.drafts d    on d.id = r.draft_id
    join public.gameweeks g on g.id = d.gameweek_id
    join public.profiles pr on pr.id = r.user_id
    left join public.fixtures f on f.id = r.fixture_id
    left join public.teams h on h.id = f.home_team_id
    left join public.teams a on a.id = f.away_team_id
   where r.notified_at is null
     -- Past the deadline there is nothing they can do about it, and the
     -- shortfall sweep below has already filled the gap.
     and g.draft_closes_at > now()
   group by pr.id, pr.display_name, pr.email, r.draft_id, r.user_id,
            d.picks_per_player, g.number, g.draft_closes_at
  having (d.picks_per_player - (
            select count(*) from public.picks p
             where p.draft_id = r.draft_id and p.user_id = r.user_id
          )) > 0;
$$;

revoke all on function public.pending_pick_releases() from public, anon, authenticated;


create or replace function public.mark_pick_releases_notified(p_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_marked integer;
begin
  update public.pick_releases
     set notified_at = now()
   where id = any (p_ids)
     and notified_at is null;
  get diagnostics v_marked = row_count;
  return v_marked;
end;
$$;

revoke all on function public.mark_pick_releases_notified(uuid[]) from public, anon, authenticated;


-- ------------------------------------------------------------
--  Choosing a fixture for somebody, in one place
--
--  Lifted out of auto_pick unchanged so the shortfall sweep below backs
--  the same side it would. Two copies of this query is two sets of
--  auto-picks that disagree about what the house would have done.
-- ------------------------------------------------------------
create or replace function public.auto_fill_player(
  p_draft_id uuid,
  p_user_id  uuid
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_draft   public.drafts%rowtype;
  v_cards   uuid[];
  v_made    integer;
  v_next    integer;
  v_choice  record;
  v_outcome public.outcome;
  v_added   integer := 0;
begin
  select * into v_draft from public.drafts where id = p_draft_id;
  if not found then return 0; end if;

  v_cards := public.draft_competitions(p_draft_id);

  select count(*) into v_made
    from public.picks where draft_id = p_draft_id and user_id = p_user_id;

  while v_made < v_draft.picks_per_player loop
    select f.id as fixture_id,
           (ht.elo_rating + 100 - at.elo_rating) as edge
      into v_choice
      from public.fixtures f
      join public.teams ht on ht.id = f.home_team_id
      join public.teams at on at.id = f.away_team_id
     where f.gameweek_id    = v_draft.gameweek_id
       and f.competition_id = any (v_cards)
       and f.status         = 'scheduled'
       and f.kickoff_at     > now()
       and not exists (
         select 1 from public.picks p
          where p.draft_id = p_draft_id and p.fixture_id = f.id
       )
     order by (ht.elo_rating is not null and at.elo_rating is not null) desc,
              abs(ht.elo_rating + 100 - at.elo_rating) desc,
              f.kickoff_at asc
     limit 1;

    exit when not found;

    -- A null edge means one of the sides is unrated, and coalesce makes
    -- the fallback explicit: with nothing to compare, back the home side.
    v_outcome := case when coalesce(v_choice.edge, 0) >= 0 then 'HOME' else 'AWAY' end::public.outcome;

    select coalesce(max(pick_number), -1) + 1 into v_next
      from public.picks where draft_id = p_draft_id;

    insert into public.picks
      (draft_id, user_id, fixture_id, predicted_outcome, pick_number, is_auto_pick)
    values
      (p_draft_id, p_user_id, v_choice.fixture_id, v_outcome, v_next, true);

    v_made  := v_made + 1;
    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$$;

revoke all on function public.auto_fill_player(uuid, uuid) from public, anon, authenticated;


create or replace function public.auto_pick(p_draft_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_draft public.drafts%rowtype;
  v_uid   uuid;
  v_added integer;
begin
  select * into v_draft from public.drafts where id = p_draft_id for update;
  if not found or v_draft.status <> 'active' then return 0; end if;

  v_uid := public.draft_user_at_turn(v_draft.pick_order, v_draft.current_turn);
  if v_uid is null then return 0; end if;

  v_added := public.auto_fill_player(p_draft_id, v_uid);

  perform public.advance_draft_turn(p_draft_id);
  return v_added;
end;
$$;

revoke all on function public.auto_pick(uuid) from public, anon, authenticated;
grant execute on function public.auto_pick(uuid) to service_role;


-- ------------------------------------------------------------
--  Nobody goes into the weekend a pick down
--
--  Deliberately not tied to a turn or to a draft still being active.
--  Both of those are about the order people pick in, and this runs after
--  the order has stopped mattering: picking has closed, and whatever is
--  missing now is missing for good unless something fills it.
-- ------------------------------------------------------------
create or replace function public.auto_pick_shortfalls()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_row   record;
  v_added integer := 0;
begin
  for v_row in
    select d.id as draft_id, u.user_id
      from public.gameweeks g
      join public.drafts d on d.gameweek_id = g.id
      cross join lateral unnest(d.pick_order) as u(user_id)
     where g.status = 'drafting'
       and g.draft_closes_at <= now()
       and (
         select count(*) from public.picks p
          where p.draft_id = d.id and p.user_id = u.user_id
       ) < d.picks_per_player
  loop
    v_added := v_added + public.auto_fill_player(v_row.draft_id, v_row.user_id);
  end loop;

  return v_added;
end;
$$;

revoke all on function public.auto_pick_shortfalls() from public, anon, authenticated;
grant execute on function public.auto_pick_shortfalls() to service_role;
