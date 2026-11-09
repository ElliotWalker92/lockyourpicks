-- ============================================================
--  An admin's "this game is off" has to outlive the nightly ingest
--
--  0059 let an admin call a fixture off. The next 04:00 refresh put all
--  six of them straight back on: ingest/fixtures.ts rebuilds every
--  fixture row it fetches, status included, for future fixtures as well
--  as played ones, and the provider still had them as "not started".
--  Players could pick a called-off game again by breakfast, and nothing
--  anywhere said the override had been lost.
--
--  So the override is now a fact about the row rather than a value that
--  the next write happens to agree with. `status_override` marks a
--  status a person set, and a trigger refuses to let anything else move
--  it.
--
--  The guard is a trigger rather than a condition in the ingest because
--  the ingest is not the only writer and will not be the last one. A
--  rule that lives next to the data holds for whatever calls it next.
-- ============================================================

alter table public.fixtures
  add column if not exists status_override boolean not null default false;

comment on column public.fixtures.status_override is
  'True when a person set this fixture''s status. While it is set, only '
  'another deliberate admin change may alter status — the provider feed '
  'cannot. Cleared by putting the fixture back to scheduled.';

create or replace function public.keep_admin_fixture_status()
returns trigger language plpgsql as $$
begin
  -- Two ways to be a deliberate change: the admin function announces
  -- itself, and a direct write that sets the flag in the same statement
  -- is obviously a person. Anything else moving the status of an
  -- overridden row is a feed, and is ignored.
  if OLD.status_override
     and NEW.status is distinct from OLD.status
     and coalesce(current_setting('app.fixture_admin', true), '') <> 'on'
     and NEW.status_override is not distinct from OLD.status_override then
    NEW.status := OLD.status;
  end if;
  return NEW;
end;
$$;

drop trigger if exists fixtures_keep_admin_status on public.fixtures;
create trigger fixtures_keep_admin_status
  before update of status on public.fixtures
  for each row execute procedure public.keep_admin_fixture_status();


create or replace function public.admin_set_fixture_status(
  p_fixture_id uuid,
  p_status     public.fixture_status
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_released jsonb := '[]'::jsonb;
  v_label    text;
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

  if p_status in ('postponed', 'cancelled') then
    with gone as (
      delete from public.picks p
       using public.drafts d, public.gameweeks g
       where p.fixture_id = p_fixture_id
         and d.id = p.draft_id
         and g.id = d.gameweek_id
         and g.draft_closes_at > now()
      returning p.user_id
    )
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
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
      into v_released
      from (select distinct user_id from gone) g
      join public.profiles pr on pr.id = g.user_id;
  end if;

  -- Tells the trigger this one is deliberate, and takes it back
  -- immediately afterwards. The setting is transaction-local, so leaving
  -- it raised would wave through anything else writing a status later in
  -- the same transaction — which is nothing today, and exactly the sort
  -- of thing that stops being true quietly.
  perform set_config('app.fixture_admin', 'on', true);

  update public.fixtures
     set status          = p_status,
         -- Putting a fixture back hands it to the provider again, which
         -- is what you want when a postponement is reversed or was a
         -- mistake.
         status_override = (p_status <> 'scheduled'),
         updated_at      = now()
   where id = p_fixture_id;

  perform set_config('app.fixture_admin', '', true);

  return jsonb_build_object(
    'fixture',  v_label,
    'released', jsonb_array_length(v_released),
    'players',  v_released
  );
end;
$$;

revoke all     on function public.admin_set_fixture_status(uuid, public.fixture_status) from public, anon;
grant  execute on function public.admin_set_fixture_status(uuid, public.fixture_status) to authenticated;
