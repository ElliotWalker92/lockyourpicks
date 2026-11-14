\set ON_ERROR_STOP on

-- Two spare fixtures, so there is something to replace a pick with and
-- something for the clock to fill a gap with.
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

-- A1. Rule 2. The game was on when they picked it and is called off
--     afterwards. The pick stands and will score on the rearranged date.
update public.fixtures set status = 'postponed'
 where id = 'cccccccc-0000-0000-0000-000000000001';

do $$
declare n integer; r integer; stamped timestamptz;
begin
  select count(*) into n from public.picks
   where fixture_id = 'cccccccc-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'A1 FAIL: the pick was taken away (% left)', n; end if;

  select postponed_at into stamped from public.fixtures
   where id = 'cccccccc-0000-0000-0000-000000000001';
  if stamped is null then raise exception 'A1 FAIL: postponed_at not stamped'; end if;

  select count(*) into r from public.pick_releases;
  if r <> 0 then raise exception 'A1 FAIL: % release rows for a pick that should ride', r; end if;

  if (select count(*) from public.pending_pick_releases()) <> 0 then
    raise exception 'A1 FAIL: somebody is being told about a pick that still stands';
  end if;
  raise notice 'A1 ok  a game that goes off after the pick keeps the pick';
end $$;

-- A2. Rule 1. The game was already known to be off when they picked it —
--     which is how it really happened: the ingest put six called-off games
--     back on the board, four players picked them, and the ingest then
--     agreed they were off. So postponed_at predates the pick.
update public.fixtures set postponed_at = now() - interval '2 days'
 where id = 'cccccccc-0000-0000-0000-000000000002';

update public.fixtures set status = 'postponed'
 where id = 'cccccccc-0000-0000-0000-000000000002';

do $$
declare n integer; r integer; stamped timestamptz;
begin
  select count(*) into n from public.picks
   where fixture_id = 'cccccccc-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'A2 FAIL: % picks left on a game already off', n; end if;

  select count(*) into r from public.pick_releases where notified_at is null;
  if r <> 1 then raise exception 'A2 FAIL: % release rows, expected 1', r; end if;

  select postponed_at into stamped from public.fixtures
   where id = 'cccccccc-0000-0000-0000-000000000002';
  if stamped > now() - interval '1 day' then
    raise exception 'A2 FAIL: the first sighting was overwritten (%), which is the fact that decides the case', stamped;
  end if;
  raise notice 'A2 ok  a pick made on a game already off comes back, and the first sighting is kept';
end $$;

-- A3. Who to tell, and what they are short.
do $$
declare row record;
begin
  select * into row from public.pending_pick_releases();
  if row.user_id <> 'dddddddd-0000-0000-0000-000000000001' then
    raise exception 'A3 FAIL: wrong player %', row.user_id;
  end if;
  if row.short <> 1 then raise exception 'A3 FAIL: short = %, expected 1', row.short; end if;
  if row.email is null then raise exception 'A3 FAIL: no address to write to'; end if;
  raise notice 'A3 ok  % is short % for gameweek %', row.display_name, row.short, row.gameweek;
end $$;

-- A4. They can replace it, and then there is nothing left to say.
do $$
declare made public.picks; p integer;
begin
  perform set_config('request.jwt.claim.sub',
                     'dddddddd-0000-0000-0000-000000000001', true);
  made := public.make_pick(
    '99999999-0000-0000-0000-000000000001',
    'cccccccc-0000-0000-0000-000000000007',
    'HOME'
  );
  if made.id is null then raise exception 'A4 FAIL: make_pick returned nothing'; end if;
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into p from public.picks
   where draft_id = '99999999-0000-0000-0000-000000000001'
     and user_id  = 'dddddddd-0000-0000-0000-000000000001';
  if p <> 2 then raise exception 'A4 FAIL: % picks after replacing, expected 2', p; end if;
  if (select count(*) from public.pending_pick_releases()) <> 0 then
    raise exception 'A4 FAIL: still nagging about a gap they have filled';
  end if;
  raise notice 'A4 ok  replacement accepted, and the nagging stops';
end $$;

-- A5. Stamping it, once.
do $$
declare marked integer; ids uuid[];
begin
  select array_agg(id) into ids from public.pick_releases where notified_at is null;
  select public.mark_pick_releases_notified(ids) into marked;
  if marked <> 1 then raise exception 'A5 FAIL: marked %, expected 1', marked; end if;
  select public.mark_pick_releases_notified(ids) into marked;
  if marked <> 0 then raise exception 'A5 FAIL: stamped an already-stamped row again'; end if;
  raise notice 'A5 ok  stamped once, and only once';
end $$;

-- A6. An admin calling a game off is us *learning* it is off, so the picks
--     on it stand. The panel reports nobody, because nobody lost anything.
do $$
declare res jsonb; n integer; o boolean; stamped timestamptz;
begin
  perform set_config('request.jwt.claim.sub',
                     'dddddddd-0000-0000-0000-000000000004', true);
  res := public.admin_set_fixture_status(
    'cccccccc-0000-0000-0000-000000000003', 'postponed'
  );
  perform set_config('request.jwt.claim.sub', '', true);

  if (res->>'released')::int <> 0 then
    raise exception 'A6 FAIL: released %, expected 0 — %', res->>'released', res;
  end if;
  if jsonb_array_length(res->'players') <> 0 then
    raise exception 'A6 FAIL: told % players about a pick that stands',
      jsonb_array_length(res->'players');
  end if;

  select count(*) into n from public.picks
   where fixture_id = 'cccccccc-0000-0000-0000-000000000003';
  if n <> 1 then raise exception 'A6 FAIL: the pick went anyway'; end if;

  select status_override, postponed_at into o, stamped
    from public.fixtures where id = 'cccccccc-0000-0000-0000-000000000003';
  if not o then raise exception 'A6 FAIL: override not set'; end if;
  if stamped is null then raise exception 'A6 FAIL: not stamped'; end if;
  raise notice 'A6 ok  an admin call-off leaves the picks that were made in good faith';
end $$;

-- A7. An admin putting it back says the postponement was wrong, so the
--     first sighting goes with it — otherwise every pick made afterwards
--     would look like a pick on a game already off.
do $$
declare s public.fixture_status; o boolean; stamped timestamptz;
begin
  perform set_config('request.jwt.claim.sub',
                     'dddddddd-0000-0000-0000-000000000004', true);
  perform public.admin_set_fixture_status(
    'cccccccc-0000-0000-0000-000000000003', 'scheduled'
  );
  perform set_config('request.jwt.claim.sub', '', true);

  select status, status_override, postponed_at into s, o, stamped
    from public.fixtures where id = 'cccccccc-0000-0000-0000-000000000003';
  if s <> 'scheduled' then raise exception 'A7 FAIL: status is %', s; end if;
  if o then raise exception 'A7 FAIL: override still set'; end if;
  if stamped is not null then raise exception 'A7 FAIL: postponed_at kept (%)', stamped; end if;
  raise notice 'A7 ok  putting it back forgets the postponement, as it should';
end $$;

-- A8. 0061 still holds: the feed cannot move an overridden fixture, and a
--     blocked write neither releases nor stamps.
do $$
declare s public.fixture_status; before timestamptz; after timestamptz; r integer;
begin
  perform set_config('request.jwt.claim.sub',
                     'dddddddd-0000-0000-0000-000000000004', true);
  perform public.admin_set_fixture_status(
    'cccccccc-0000-0000-0000-000000000004', 'postponed'
  );
  perform set_config('request.jwt.claim.sub', '', true);

  select postponed_at into before from public.fixtures
   where id = 'cccccccc-0000-0000-0000-000000000004';
  select count(*) into r from public.pick_releases;

  -- The feed, trying to put it back on.
  update public.fixtures set status = 'scheduled'
   where id = 'cccccccc-0000-0000-0000-000000000004';

  select status, postponed_at into s, after from public.fixtures
   where id = 'cccccccc-0000-0000-0000-000000000004';
  if s <> 'postponed' then raise exception 'A8 FAIL: the feed moved it to %', s; end if;
  if after is distinct from before then
    raise exception 'A8 FAIL: a blocked write changed postponed_at';
  end if;
  if (select count(*) from public.pick_releases) <> r then
    raise exception 'A8 FAIL: a blocked write wrote a release row';
  end if;
  raise notice 'A8 ok  the override held, and the blocked write changed nothing';
end $$;

-- A9. One more rule-1 release, to leave somebody short for the clock.
update public.fixtures set postponed_at = now() - interval '2 days'
 where id = 'cccccccc-0000-0000-0000-000000000005';
update public.fixtures set status = 'postponed'
 where id = 'cccccccc-0000-0000-0000-000000000005';

do $$
declare p integer;
begin
  select count(*) into p from public.picks
   where draft_id = '99999999-0000-0000-0000-000000000001'
     and user_id  = 'dddddddd-0000-0000-0000-000000000003';
  if p <> 1 then raise exception 'A9 SETUP: expected 1 pick left, got %', p; end if;
  raise notice 'A9 ok  Player 3 is a pick short with their turn gone';
end $$;

-- A10. Nothing is auto-filled while they can still choose.
do $$
declare added integer;
begin
  select public.auto_pick_shortfalls() into added;
  if added <> 0 then raise exception 'A10 FAIL: filled % before the deadline', added; end if;
  raise notice 'A10 ok  no auto-pick while picking is open';
end $$;


-- ============================================================
--  B: picking has closed
-- ============================================================
update public.gameweeks set draft_closes_at = now() - interval '1 hour'
 where id = 'aaaaaaaa-0000-0000-0000-000000000003';

-- B1. Whoever is still short gets filled, once.
do $$
declare added integer; p integer; a integer;
begin
  select public.auto_pick_shortfalls() into added;
  if added <> 1 then raise exception 'B1 FAIL: filled %, expected 1', added; end if;

  select count(*), count(*) filter (where is_auto_pick) into p, a
    from public.picks
   where draft_id = '99999999-0000-0000-0000-000000000001'
     and user_id  = 'dddddddd-0000-0000-0000-000000000003';
  if p <> 2 then raise exception 'B1 FAIL: % picks, expected 2', p; end if;
  if a <> 1 then raise exception 'B1 FAIL: % auto, expected 1', a; end if;

  select public.auto_pick_shortfalls() into added;
  if added <> 0 then raise exception 'B1 FAIL: filled % on a second pass', added; end if;
  raise notice 'B1 ok  the gap was filled once, by the clock';
end $$;

-- B2. A closed round keeps its picks even in the rule-1 case: they cannot
--     pick again, so taking it away would only cost them the pick.
do $$
declare n integer; r integer;
begin
  select count(*) into r from public.pick_releases;
  update public.fixtures set postponed_at = now() - interval '3 days'
   where id = 'cccccccc-0000-0000-0000-000000000006';
  update public.fixtures set status = 'postponed'
   where id = 'cccccccc-0000-0000-0000-000000000006';

  select count(*) into n from public.picks
   where fixture_id = 'cccccccc-0000-0000-0000-000000000006';
  if n <> 1 then raise exception 'B2 FAIL: a closed round lost a pick'; end if;
  if (select count(*) from public.pick_releases) <> r then
    raise exception 'B2 FAIL: a closed round wrote a release row';
  end if;
  if (select count(*) from public.pending_pick_releases()) <> 0 then
    raise exception 'B2 FAIL: something is pending in a closed round';
  end if;
  raise notice 'B2 ok  a closed round keeps its picks, and says nothing';
end $$;


-- ============================================================
--  C: the turn clock, which 0062 rewrote to share its choosing rule
-- ============================================================
update public.gameweeks set draft_closes_at = now() + interval '2 hours'
 where id = 'aaaaaaaa-0000-0000-0000-000000000003';

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
declare ran integer; p integer; a integer; turn integer;
begin
  select public.run_expired_turns() into ran;
  if ran < 1 then raise exception 'C1 FAIL: ran % expired turns', ran; end if;

  select count(*), count(*) filter (where is_auto_pick) into p, a
    from public.picks
   where draft_id = '99999999-0000-0000-0000-000000000002'
     and user_id  = 'dddddddd-0000-0000-0000-000000000005';
  if p <> 2 then raise exception 'C1 FAIL: % picks for the expired seat, expected 2', p; end if;
  if a <> 2 then raise exception 'C1 FAIL: % of them auto, expected 2', a; end if;

  select current_turn into turn from public.drafts
   where id = '99999999-0000-0000-0000-000000000002';
  if turn < 1 then raise exception 'C1 FAIL: turn did not advance (still %)', turn; end if;
  raise notice 'C1 ok  an expired turn is auto-picked and the turn moves on';
end $$;

do $$
declare bad integer;
begin
  select count(*) into bad
    from public.picks p
    join public.fixtures f on f.id = p.fixture_id
   where p.is_auto_pick and f.status <> 'scheduled';
  if bad <> 0 then
    raise exception 'C2 FAIL: % auto-picks sitting on a game that is off', bad;
  end if;
  raise notice 'C2 ok  no auto-pick landed on a postponed fixture';
end $$;


-- ============================================================
--  D: settlement, and the total catching up afterwards
-- ============================================================

-- Player 2's picks: one played, one cancelled outright.
update public.fixtures
   set status = 'finished', home_score = 0, away_score = 2,
       kickoff_at = now() - interval '3 hours'
 where id = 'cccccccc-0000-0000-0000-000000000003';

do $$
declare res jsonb;
begin
  perform set_config('request.jwt.claim.sub',
                     'dddddddd-0000-0000-0000-000000000004', true);
  res := public.admin_set_fixture_status(
    'cccccccc-0000-0000-0000-000000000004', 'cancelled'
  );
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

do $$
declare riding integer; dead integer; won integer;
begin
  perform public.settle_gameweek('aaaaaaaa-0000-0000-0000-000000000003');

  -- Postponed: pending, because the match is going to be played. Scoring
  -- it zero now would be permanent, since a settled gameweek is never
  -- revisited.
  select points_awarded into riding from public.picks
   where fixture_id = 'cccccccc-0000-0000-0000-000000000001';
  if riding is not null then
    raise exception 'D1 FAIL: a postponed pick was scored % instead of left pending', riding;
  end if;

  -- Cancelled: nothing is coming, so zero.
  select points_awarded into dead from public.picks
   where fixture_id = 'cccccccc-0000-0000-0000-000000000004';
  if dead is distinct from 0 then
    raise exception 'D1 FAIL: a cancelled pick scored % instead of 0', dead;
  end if;

  -- And an ordinary result still scores. Player 2 called AWAY, it finished
  -- 0-2.
  select points_awarded into won from public.picks
   where fixture_id = 'cccccccc-0000-0000-0000-000000000003';
  if won is distinct from 1 then
    raise exception 'D1 FAIL: a correct call scored % instead of 1', won;
  end if;
  raise notice 'D1 ok  postponed is pending, cancelled is nil, played is scored';
end $$;

-- D2. A total that has gone stale because a pick scored late.
do $$
declare fixed integer; stored integer; live integer;
begin
  update public.gameweek_scores
     set points = points - 1
   where user_id = 'dddddddd-0000-0000-0000-000000000002'
     and gameweek_id = 'aaaaaaaa-0000-0000-0000-000000000003';

  select public.rescore_stale_gameweeks() into fixed;
  if fixed <> 1 then raise exception 'D2 FAIL: rewrote % gameweeks, expected 1', fixed; end if;

  select s.points into stored from public.gameweek_scores s
   where s.user_id = 'dddddddd-0000-0000-0000-000000000002'
     and s.gameweek_id = 'aaaaaaaa-0000-0000-0000-000000000003';
  select coalesce(sum(p.points_awarded), 0) into live
    from public.picks p
    join public.drafts d on d.id = p.draft_id
   where d.gameweek_id = 'aaaaaaaa-0000-0000-0000-000000000003'
     and p.user_id = 'dddddddd-0000-0000-0000-000000000002';
  if stored <> live then
    raise exception 'D2 FAIL: table says %, picks say %', stored, live;
  end if;

  select public.rescore_stale_gameweeks() into fixed;
  if fixed <> 0 then raise exception 'D2 FAIL: rewrote % on a clean second pass', fixed; end if;
  raise notice 'D2 ok  a stale total is rewritten from the picks behind it, once';
end $$;

-- D3. Correcting a total must never create one.
--
--     This is the fault 0064 fixes, and it cost a player sixteen points on
--     the live table: a row whose (player, gameweek, division) has no live
--     picks behind it is history from before they changed division, not a
--     number to recompute. An upsert "fixed" it by writing a second row
--     under the division their current draft belongs to and leaving the
--     first, doubling the season.
do $$
declare before_n integer; after_n integer; fixed integer; orphan integer;
begin
  insert into public.gameweek_scores
    (user_id, gameweek_id, division_id, points, correct_count, settled_at)
  values ('dddddddd-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000003',
          'ffffffff-0000-0000-0000-000000000002',
          7, 7, now() - interval '30 days');

  select count(*) into before_n from public.gameweek_scores;
  select public.rescore_stale_gameweeks() into fixed;
  select count(*) into after_n from public.gameweek_scores;

  if after_n <> before_n then
    raise exception 'D3 FAIL: the sweep created rows (% -> %)', before_n, after_n;
  end if;

  select points into orphan from public.gameweek_scores
   where user_id     = 'dddddddd-0000-0000-0000-000000000001'
     and division_id = 'ffffffff-0000-0000-0000-000000000002';
  if orphan <> 7 then
    raise exception 'D3 FAIL: history under a division they have left was rewritten to %', orphan;
  end if;
  raise notice 'D3 ok  a total with no picks behind it is left alone, and nothing is invented';
end $$;

select 'ALL ASSERTIONS PASSED' as result;
