-- ============================================================
--  0024 — every scheduled job in one round trip, and atomically
--
--  Cloudflare's free Workers plan allows 50 outbound requests per
--  invocation. Every database call from a cron job is one of them, and
--  the jobs were written a row at a time:
--
--    results   one UPDATE per fixture — a full Saturday is well past 50
--    elo       one UPDATE per team, of which there are now 316
--    ingest    fixture import and the gameweek re-cut in one invocation
--
--  Past the ceiling the Worker's fetch throws, and the job stops wherever
--  it happens to be. For the Elo job that meant roughly 30 of the 92
--  league clubs rated per week and 208 teams never rated at all. For the
--  re-cut it was worse, because the re-cut is a migration of the season's
--  shape: it had inserted eight new gameweeks and moved fixtures onto them
--  when it was cut off, and never got as far as removing the originals or
--  renumbering. GW7–GW11 were left as empty shells — settled with no
--  fixtures, or open for drafting with nothing to draft — while 10001–10008
--  held the matches.
--
--  None of it was reported, because each step's error went unread.
--
--  The fix is not a bigger request budget, though that would help. It's
--  that anything which changes several rows as one idea has to happen in
--  one statement or one function, so it either all lands or none of it
--  does. Each function below is a single transaction and a single request.
-- ============================================================


-- ------------------------------------------------------------
--  Results
-- ------------------------------------------------------------
--
--  Takes every fixture the provider reported, ours or not — the join on
--  provider_fixture_id discards the rest — and writes only the rows that
--  actually changed, so `updated` finally means what it says.
--
--  Returns the competitions in which a fixture has just finished, which is
--  exactly the set whose league table has moved.
create or replace function public.apply_fixture_results(p_updates jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_updated  integer;
  v_newly    integer;
  v_finished uuid[];
begin
  with incoming as (
    select (e->>'provider_fixture_id')::integer              as pid,
           (e->>'home_score')::integer                        as home_score,
           (e->>'away_score')::integer                        as away_score,
           (e->>'status')::public.fixture_status              as status
      from jsonb_array_elements(p_updates) e
  ),
  -- Read before the write: a writable CTE's siblings see the table as it
  -- was, which is how the old status survives to be compared.
  changed as (
    select f.id, f.competition_id, f.status as was, i.*
      from public.fixtures f
      join incoming i on i.pid = f.provider_fixture_id
     where f.home_score is distinct from i.home_score
        or f.away_score is distinct from i.away_score
        or f.status     is distinct from i.status
  ),
  written as (
    update public.fixtures f
       set home_score = c.home_score,
           away_score = c.away_score,
           status     = c.status,
           updated_at = now()
      from changed c
     where f.id = c.id
    returning f.id
  )
  select count(*),
         count(*) filter (where c.status = 'finished' and c.was <> 'finished'),
         coalesce(
           array_agg(distinct c.competition_id)
             filter (where c.status = 'finished' and c.was <> 'finished'),
           '{}')
    into v_updated, v_newly, v_finished
    from written w
    join changed c on c.id = w.id;

  return jsonb_build_object(
    'updated', v_updated,
    'finished', v_newly,
    'finished_competitions', to_jsonb(v_finished)
  );
end;
$$;

revoke all on function public.apply_fixture_results(jsonb) from public, anon, authenticated;
grant execute on function public.apply_fixture_results(jsonb) to service_role;


-- ------------------------------------------------------------
--  Elo
-- ------------------------------------------------------------
create or replace function public.apply_team_elo(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update public.teams t
     set elo_rating     = (e->>'elo_rating')::numeric,
         elo_updated_at = now()
    from jsonb_array_elements(p_rows) e
   where t.id = (e->>'id')::uuid;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.apply_team_elo(jsonb) from public, anon, authenticated;
grant execute on function public.apply_team_elo(jsonb) to service_role;


-- ------------------------------------------------------------
--  Re-cutting gameweeks
-- ------------------------------------------------------------
--
--  The TypeScript works out the shape — which fixtures form which block,
--  and each block's draft window — because that's where the rules live and
--  are tested. This applies it: create the new gameweeks, move the
--  fixtures, drop the gameweeks being replaced, renumber the season by
--  date. One transaction, so a failure anywhere leaves the season exactly
--  as it was.
--
--  p_replace:      gameweeks being replaced. None may have a draft — a
--                  gameweek someone has picked in is never re-cut, and
--                  finding one here means the caller's idea of what is
--                  frozen is wrong, which is reason enough to stop.
--  p_blocks:       [{opens_at, closes_at, first_kickoff_at, fixture_ids}]
--  p_clear_drafts: the destructive full re-cut, which is allowed to take
--                  drafts and scores with it. Never set by the schedule.
create or replace function public.apply_recut(
  p_season_id    uuid,
  p_replace      uuid[],
  p_blocks       jsonb,
  p_clear_drafts boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_block   jsonb;
  v_gw      uuid;
  v_i       integer := 0;
  v_moved   integer := 0;
  v_n       integer;
  v_cleared integer := 0;
begin
  if p_clear_drafts then
    delete from public.gameweek_scores where gameweek_id = any(p_replace);
    delete from public.drafts where gameweek_id = any(p_replace);
    get diagnostics v_cleared = row_count;
  elsif exists (
    select 1 from public.drafts where gameweek_id = any(p_replace)
  ) then
    raise exception
      'Refusing to re-cut: a gameweek being replaced already has a draft.';
  end if;

  for v_block in select * from jsonb_array_elements(p_blocks)
  loop
    v_i := v_i + 1;
    -- Out of the way of every real number until the renumber below.
    insert into public.gameweeks
      (season_id, number, name, draft_opens_at, draft_closes_at,
       first_kickoff_at, status)
    values
      (p_season_id, 900000 + v_i, 'Gameweek',
       (v_block->>'opens_at')::timestamptz,
       (v_block->>'closes_at')::timestamptz,
       (v_block->>'first_kickoff_at')::timestamptz,
       'upcoming')
    returning id into v_gw;

    update public.fixtures
       set gameweek_id = v_gw
     where id in (
       select (jsonb_array_elements_text(v_block->'fixture_ids'))::uuid
     );
    get diagnostics v_n = row_count;
    v_moved := v_moved + v_n;
  end loop;

  -- Anything still holding a fixture was not fully replaced; deleting it
  -- would cascade those fixtures away. Stop rather than lose them.
  if exists (
    select 1 from public.fixtures where gameweek_id = any(p_replace)
  ) then
    raise exception
      'Refusing to re-cut: a gameweek being replaced still has fixtures.';
  end if;

  delete from public.gameweeks where id = any(p_replace);

  perform public.renumber_gameweeks(p_season_id);

  return jsonb_build_object(
    'created', v_i,
    'fixtures_moved', v_moved,
    'replaced', coalesce(array_length(p_replace, 1), 0),
    'drafts_cleared', v_cleared
  );
end;
$$;

revoke all on function public.apply_recut(uuid, uuid[], jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.apply_recut(uuid, uuid[], jsonb, boolean)
  to service_role;


-- Number the season 1..N by when each gameweek locks. Two passes, because
-- numbers are unique per season and a straight renumber collides with
-- itself partway through.
create or replace function public.renumber_gameweeks(p_season_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  with ordered as (
    select id, row_number() over (order by draft_closes_at, number) as rn
      from public.gameweeks where season_id = p_season_id
  )
  update public.gameweeks g
     set number = 800000 + o.rn
    from ordered o where g.id = o.id;

  update public.gameweeks
     set number = number - 800000,
         name   = 'Gameweek ' || (number - 800000)
   where season_id = p_season_id;
end;
$$;

revoke all on function public.renumber_gameweeks(uuid) from public, anon, authenticated;
grant execute on function public.renumber_gameweeks(uuid) to service_role;


-- ------------------------------------------------------------
--  Knowing when a job is failing
-- ------------------------------------------------------------
--
--  The standings job answered HTTP 200 and `ok: true` for eight days while
--  every league it asked for was refused. One row per job, written at the
--  end of every run, so "is anything broken" is a query and an email
--  rather than somebody noticing the table looks old.
create table if not exists public.cron_status (
  job           text primary key,
  last_run_at   timestamptz not null,
  last_ok       boolean not null,
  last_errors   jsonb not null default '[]'::jsonb,
  -- Consecutive failed runs. The alert waits for two, so one rate-limited
  -- run that recovers on the next doesn't send anybody an email.
  failures      integer not null default 0,
  failing_since timestamptz,
  alerted_at    timestamptz
);

alter table public.cron_status enable row level security;

drop policy if exists "cron_status: admin read" on public.cron_status;
create policy "cron_status: admin read"
  on public.cron_status for select using (public.is_admin());


-- ------------------------------------------------------------
--  Repair 1: FA Cup qualifying rounds
-- ------------------------------------------------------------
--
--  The cup import took every round, including the qualifiers, where
--  neither side is one of the 92. That added 224 non-league clubs and a
--  hundred-odd fixtures to gameweeks — matches nobody can sensibly call
--  and the model knows nothing about. A cup tie stays if at least one side
--  is in one of our four league tables; the rest go, unless somebody has
--  already picked one, which is left for a human.
with league_teams as (
  select distinct s.team_id
    from public.standings s
    join public.seasons se on se.id = s.season_id and se.is_active
)
delete from public.fixtures f
 using public.competitions c
 where c.id = f.competition_id
   and c.is_cup
   and f.home_team_id not in (select team_id from league_teams)
   and f.away_team_id not in (select team_id from league_teams)
   and not exists (select 1 from public.picks p where p.fixture_id = f.id);

delete from public.teams t
 where not exists (
         select 1 from public.fixtures f
          where f.home_team_id = t.id or f.away_team_id = t.id)
   and not exists (select 1 from public.standings s where s.team_id = t.id);


-- ------------------------------------------------------------
--  Repair 2: the empty shells the interrupted re-cut left behind
--
--  After the cup cleanup, not before: a gameweek that held only
--  qualifiers is empty now too, and belongs in the same sweep.
-- ------------------------------------------------------------
--
--  A gameweek with no fixtures whose drafts hold no picks. Nothing anyone
--  did lives here: a draft over an empty board can't hold a pick, and the
--  scores attached are zeros for rounds that never had any matches.
--  The numbering is put right afterwards.
delete from public.gameweeks g
 where not exists (select 1 from public.fixtures f where f.gameweek_id = g.id)
   and not exists (
     select 1 from public.picks p
       join public.drafts d on d.id = p.draft_id
      where d.gameweek_id = g.id
   );

select public.renumber_gameweeks(id) from public.seasons where is_active;
