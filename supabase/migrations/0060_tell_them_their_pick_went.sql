-- ============================================================
--  Who to tell when a fixture is called off
--
--  0059 released the picks on a called-off fixture but said only how
--  many. From the player's side a pick simply vanishes, with nothing in
--  the app to explain it — the first person it happened to had to be
--  told by hand, in a group chat.
--
--  So the function now returns who was affected, and the admin action
--  notifies them through the same `deliver` path everything else uses:
--  a push where they have a device, an email where they do not.
--
--  Deliberately ids and devices, never addresses. Migration 0057 took
--  profiles.email away from `authenticated` after finding every player's
--  address world-readable; handing it back through an RPC's return value
--  would undo that for the sake of a convenience the server action does
--  not need. The action already holds a service-role client for the
--  send, and the push rows are useless without the VAPID key.
-- ============================================================

drop function if exists public.admin_set_fixture_status(uuid, public.fixture_status);

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
         -- A round that has already closed is history. Reopening it
         -- would change a settled table, and the player cannot pick
         -- again anyway, so there is nothing to tell them.
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

  update public.fixtures
     set status = p_status, updated_at = now()
   where id = p_fixture_id;

  return jsonb_build_object(
    'fixture',  v_label,
    'released', jsonb_array_length(v_released),
    'players',  v_released
  );
end;
$$;

revoke all     on function public.admin_set_fixture_status(uuid, public.fixture_status) from public, anon;
grant  execute on function public.admin_set_fixture_status(uuid, public.fixture_status) to authenticated;

comment on function public.admin_set_fixture_status(uuid, public.fixture_status) is
  'Admin-only. Sets a fixture''s status and, when calling it off, deletes '
  'picks on it in rounds still open. Returns the fixture label and the '
  'players whose picks went, with their push devices, so the caller can '
  'tell them. Never returns an email address — see migration 0057.';
