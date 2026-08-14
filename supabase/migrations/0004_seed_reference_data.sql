-- ============================================================
--  Lock Your Picks v2 — reference data + admin helper
-- ============================================================


-- ------------------------------------------------------------
--  set_admin_by_email
--
--  There is no way to become an admin through the app, by design.
--  Run this from the SQL editor once, for yourself:
--
--    select public.set_admin_by_email('ehwalker92@gmail.com');
-- ------------------------------------------------------------
create or replace function public.set_admin_by_email(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where email = p_email limit 1;
  if v_id is null then
    raise exception 'No user with email %. Sign up first, then run this.', p_email;
  end if;
  update public.profiles set is_admin = true where id = v_id;
end;
$$;

revoke all on function public.set_admin_by_email(text) from public, anon, authenticated;


-- ------------------------------------------------------------
--  Season
--
--  One active season at a time (enforced by seasons_single_active).
-- ------------------------------------------------------------
insert into public.seasons (name, starts_on, ends_on, is_active)
values ('2026/27', '2026-08-08', '2027-05-30', true)
on conflict do nothing;


-- ------------------------------------------------------------
--  Competitions
--
--  provider_league_id values are API-Football league IDs.
--
--  ⚠️ VERIFY THESE before running fixture ingestion. api-football.com
--  blocks automated access, so these came from documentation rather than
--  a direct read of their coverage table. Confirm with one free call:
--
--    curl -H "x-apisports-key: $KEY" \
--      "https://v3.football.api-sports.io/leagues?country=England"
--
--  and correct any that don't match.
-- ------------------------------------------------------------
insert into public.competitions (provider_league_id, code, name, tier, is_cup, is_active)
values
  (39, 'PL',   'Premier League',   1, false, true),
  (40, 'ELC',  'Championship',     2, false, true),
  (41, 'EL1',  'League One',       3, false, true),
  (42, 'EL2',  'League Two',       4, false, true),
  (45, 'FAC',  'FA Cup',        null, true,  true),
  (48, 'EFLC', 'EFL Cup',       null, true,  true)
on conflict (code) do update
  set provider_league_id = excluded.provider_league_id,
      name               = excluded.name,
      tier               = excluded.tier,
      is_cup             = excluded.is_cup;
