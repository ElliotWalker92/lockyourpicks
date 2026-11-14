\set ON_ERROR_STOP on
\timing off

-- Two spare fixtures, so there is something to replace a pick with.
insert into public.teams (id, name, short_name, provider_team_id, elo_rating)
select ('bbbbbbbb-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       'Team ' || i, 'T' || i, 8000 + i, 1500 + i * 10
  from generate_series(13, 16) as g(i);

insert into public.fixtures
  (id, gameweek_id, competition_id, home_team_id, away_team_id, kickoff_at, status, provider_fixture_id)
select ('cccccccc-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       'aaaaaaaa-0000-0000-0000-000000000003',
       (select id from public.competitions where code = 'EL1'),
       ('bbbbbbbb-0000-0000-0000-' || lpad((i * 2 - 1)::text, 12, '0'))::uuid,
       ('bbbbbbbb-0000-0000-0000-' || lpad((i * 2)::text, 12, '0'))::uuid,
       now() + interval '1 day', 'scheduled', 7000 + i
  from generate_series(7, 8) as g(i);

-- ============================================================
--  A: the round is still open
-- ============================================================

-- A1. The feed postpones a fixture somebody picked. A plain UPDATE, which
--     is exactly what ingest/fixtures.ts does.
update public.fixtures set status = 'postponed'
 where id = 'cccccccc-0000-0000-0000-000000000001';

do $$
declare n integer; r integer;
begin
  select count(*) into n from public.picks
   where fixture_id = 'cccccccc-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'A1 FAIL: % picks left on a postponed fixture', n; end if;

  select count(*) into r from public.pick_releases
   where fixture_id = 'cccccccc-0000-0000-0000-000000000001' and notified_at is null;
  if r <> 1 then raise exception 'A1 FAIL: % release rows, expected 1', r; end if;
  raise notice 'A1 ok  feed postponement released the pick and left a note';
end $$;

-- A2. Who to tell, and what to tell them.
do $$
declare row record; n integer;
begin
  select count(*) into n from public.pending_pick_releases();
  if n <> 1 then raise exception 'A2 FAIL: % pending, expected 1', n; end if;

  select * into row from public.pending_pick_releases();
  if row.user_id <> 'dddddddd-0000-0000-0000-000000000001' then
    raise exception 'A2 FAIL: wrong player %', row.user_id;
  end if;
  if row.short <> 1 then raise exception 'A2 FAIL: short = %, expected 1', row.short; end if;
  if row.email is null then raise exception 'A2 FAIL: no address to write to'; end if;
  raise notice 'A2 ok  % is short % for gameweek %', row.display_name, row.short, row.gameweek;
end $$;

-- A3. They can take a replacement, and then there is nothing left to say.
do $$
declare n integer; p integer; made public.picks;
begin
  perform set_config('request.jwt.claim.sub',
                     'dddddddd-0000-0000-0000-000000000001', true);
  made := public.make_pick(
    '99999999-0000-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000007',
    'HOME'
  );
  if made.id is null then raise exception 'A3 FAIL: make_pick returned nothing'; end if;
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into p from public.picks
   where draft_id = '99999999-0000-0000-0000-000000000001'
     and user_id  = 'dddddddd-0000-0000-0000-000000000001';
  if p <> 2 then raise exception 'A3 FAIL: % picks after replacing, expected 2', p; end if;

  select count(*) into n from public.pending_pick_releases();
  if n <> 0 then raise exception 'A3 FAIL: still % pending after they replaced it', n; end if;
  raise notice 'A3 ok  replacement accepted, and nobody is nagged about a gap they have filled';
end $$;

-- A4. Stamping it.
do $$
declare marked integer; ids uuid[];
begin
  select array_agg(id) into ids from public.pick_releases where notified_at is null;
  select public.mark_pick_releases_notified(ids) into marked;
  if marked <> 1 then raise exception 'A4 FAIL: marked %, expected 1', marked; end if;
  select public.mark_pick_releases_notified(ids) into marked;
  if marked <> 0 then raise exception 'A4 FAIL: marked an already-stamped row again'; end if;
  raise notice 'A4 ok  stamped once, and only once';
end $$;

-- A5. The admin path still reports whose round it changed.
do $$
declare res jsonb; n integer;
begin
  perform set_config('request.jwt.claim.sub',
                     'dddddddd-0000-0000-0000-000000000004', true);
  res := public.admin_set_fixture_status(
    'cccccccc-0000-0000-0000-000000000003', 'postponed'
  );
  perform set_config('request.jwt.claim.sub', '', true);

  if (res->>'released')::int <> 1 then
    raise exception 'A5 FAIL: released %, expected 1 — %', res->>'released', res;
  end if;
  if jsonb_array_length(res->'players') <> 1 then
    raise exception 'A5 FAIL: % players, expected 1', jsonb_array_length(res->'players');
  end if;
  if res->'players'->0->>'user_id' <> 'dddddddd-0000-0000-0000-000000000002' then
    raise exception 'A5 FAIL: wrong player %', res->'players'->0->>'user_id';
  end if;
  if jsonb_array_length(res->'players'->0->'release_ids') <> 1 then
    raise exception 'A5 FAIL: no release ids to stamp';
  end if;
  if res::text like '%@example.com%' then
    raise exception 'A5 FAIL: an email address came back through the RPC';
  end if;

  select count(*) into n from public.picks
   where fixture_id = 'cccccccc-0000-0000-0000-000000000003';
  if n <> 0 then raise exception 'A5 FAIL: % picks left on it', n; end if;
  raise notice 'A5 ok  admin call-off reports the player and the rows to stamp, and no address';
end $$;

-- A6/A7. 0061 still holds, and a blocked feed write releases nothing.
do $$
declare s public.fixture_status; o boolean; r integer;
begin
  select status_override into o from public.fixtures
   where id = 'cccccccc-0000-0000-0000-000000000003';
  if not o then raise exception 'A6 FAIL: override not set by the admin call'; end if;

  select count(*) into r from public.pick_releases;

  -- The feed, trying to put it back on.
  update public.fixtures set status = 'scheduled'
   where id = 'cccccccc-0000-0000-0000-000000000003';

  select status into s from public.fixtures
   where id = 'cccccccc-0000-0000-0000-000000000003';
  if s <> 'postponed' then raise exception 'A7 FAIL: feed moved it to %', s; end if;

  if (select count(*) from public.pick_releases) <> r then
    raise exception 'A7 FAIL: a blocked write wrote a release row';
  end if;
  raise notice 'A7 ok  the override held, and the blocked write said nothing';
end $$;

-- A8. Nothing is auto-filled while picking is still open.
do $$
declare added integer;
begin
  select public.auto_pick_shortfalls() into added;
  if added <> 0 then
    raise exception 'A8 FAIL: filled % before the deadline', added;
  end if;
  raise notice 'A8 ok  no auto-pick while they can still choose';
end $$;


-- ============================================================
--  B: picking has closed
-- ============================================================
update public.gameweeks set draft_closes_at = now() - interval '1 hour'
 where id = 'aaaaaaaa-0000-0000-0000-000000000003';

-- B1. Whoever is still short gets filled.
do $$
declare added integer; p integer; a integer;
begin
  select public.auto_pick_shortfalls() into added;
  if added <> 1 then raise exception 'B1 FAIL: filled %, expected 1', added; end if;

  select count(*), count(*) filter (where is_auto_pick) into p, a
    from public.picks
   where draft_id = '99999999-0000-0000-0000-000000000001'
     and user_id  = 'dddddddd-0000-0000-0000-000000000002';
  if p <> 2 then raise exception 'B1 FAIL: % picks, expected 2', p; end if;
  if a <> 1 then raise exception 'B1 FAIL: % auto picks, expected 1', a; end if;

  select public.auto_pick_shortfalls() into added;
  if added <> 0 then raise exception 'B1 FAIL: filled % on a second pass', added; end if;
  raise notice 'B1 ok  the gap was filled once, by the clock';
end $$;

-- B2. A closed round is history: a postponement does not reopen it.
do $$
declare before integer; after integer; releases integer;
begin
  select count(*) into before from public.picks
   where fixture_id = 'cccccccc-0000-0000-0000-000000000004';
  if before <> 1 then raise exception 'B2 SETUP: % picks on it', before; end if;

  select count(*) into releases from public.pick_releases;

  update public.fixtures set status = 'postponed'
   where id = 'cccccccc-0000-0000-0000-000000000004';

  select count(*) into after from public.picks
   where fixture_id = 'cccccccc-0000-0000-0000-000000000004';
  if after <> 1 then raise exception 'B2 FAIL: a closed round lost a pick'; end if;
  if (select count(*) from public.pick_releases) <> releases then
    raise exception 'B2 FAIL: a closed round wrote a release row';
  end if;
  raise notice 'B2 ok  a closed round keeps its picks, and says nothing';
end $$;

-- B3. And nothing is pending for a round nobody can act on.
do $$
declare n integer;
begin
  select count(*) into n from public.pending_pick_releases();
  if n <> 0 then raise exception 'B3 FAIL: % pending in a closed round', n; end if;
  raise notice 'B3 ok  nothing pending once picking has shut';
end $$;


-- ============================================================
--  C: auto_pick itself, since 0062 rewrote it to share the choosing
--     rule with the shortfall sweep. This is the path that fires at
--     12:25 for a turn nobody took.
-- ============================================================
update public.gameweeks set draft_closes_at = now() + interval '2 hours'
 where id = 'aaaaaaaa-0000-0000-0000-000000000003';

-- A player belongs to one division per league per season, so this takes a
-- league of its own and two players who are not in the first one.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select ('dddddddd-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p' || i || '@example.com', 'x', now(), now(), now()
  from generate_series(5, 6) as g(i);

insert into public.leagues (id, name, owner_id, join_code)
values ('eeeeeeee-0000-0000-0000-000000000002', 'Second League',
        'dddddddd-0000-0000-0000-000000000005', 'TEST02');

insert into public.divisions (id, league_id, name, tier, season_id)
values ('ffffffff-0000-0000-0000-000000000002',
        'eeeeeeee-0000-0000-0000-000000000002', 'Division 2', 2,
        (select id from public.seasons where is_active));

insert into public.league_members (league_id, user_id)
select 'eeeeeeee-0000-0000-0000-000000000002',
       ('dddddddd-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid
  from generate_series(5, 6) as g(i);

insert into public.division_members (division_id, user_id, league_id, season_id, seat)
select 'ffffffff-0000-0000-0000-000000000002',
       ('dddddddd-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       'eeeeeeee-0000-0000-0000-000000000002',
       (select id from public.seasons where is_active),
       i - 5
  from generate_series(5, 6) as g(i);

insert into public.drafts
  (id, division_id, gameweek_id, status, pick_order, current_turn,
   picks_per_player, turn_started_at, turn_expires_at)
values ('99999999-0000-0000-0000-000000000002',
        'ffffffff-0000-0000-0000-000000000002',
        'aaaaaaaa-0000-0000-0000-000000000003',
        'active',
        array['dddddddd-0000-0000-0000-000000000005',
              'dddddddd-0000-0000-0000-000000000006']::uuid[],
        0, 2, now() - interval '1 hour', now() - interval '1 minute');

do $$
declare ran integer; p integer; a integer; turn integer; st public.draft_status;
begin
  select public.run_expired_turns() into ran;
  if ran < 1 then raise exception 'C1 FAIL: ran % expired turns', ran; end if;

  select count(*), count(*) filter (where is_auto_pick) into p, a
    from public.picks
   where draft_id = '99999999-0000-0000-0000-000000000002'
     and user_id  = 'dddddddd-0000-0000-0000-000000000005';
  if p <> 2 then raise exception 'C1 FAIL: % picks for the expired seat, expected 2', p; end if;
  if a <> 2 then raise exception 'C1 FAIL: % of them auto, expected 2', a; end if;

  select current_turn, status into turn, st from public.drafts
   where id = '99999999-0000-0000-0000-000000000002';
  if turn < 1 then raise exception 'C1 FAIL: turn did not advance (still %)', turn; end if;
  raise notice 'C1 ok  an expired turn is still auto-picked and the turn moves on (turn %, %)', turn, st;
end $$;

-- C2. An auto-pick never lands on a fixture that is off.
do $$
declare bad integer;
begin
  select count(*) into bad
    from public.picks p
    join public.fixtures f on f.id = p.fixture_id
   where p.is_auto_pick and f.status <> 'scheduled';
  if bad <> 0 then
    raise exception 'C2 FAIL: % auto-picks sitting on a fixture that is off', bad;
  end if;
  raise notice 'C2 ok  no auto-pick landed on a postponed fixture';
end $$;

select 'ALL ASSERTIONS PASSED' as result;
