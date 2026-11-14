-- Minimal world: one league, one division, three players, six fixtures.
begin;


insert into public.gameweeks (id, season_id, number, name, draft_opens_at,
                             draft_closes_at, first_kickoff_at, status)
values ('aaaaaaaa-0000-0000-0000-000000000003',
        (select id from public.seasons where is_active), 1, 'Gameweek 1',
        now() - interval '2 days',
        now() + interval '2 hours',
        now() + interval '1 day', 'drafting');

insert into public.teams (id, name, short_name, provider_team_id, elo_rating)
select ('bbbbbbbb-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       'Team ' || i, 'T' || i, 8000 + i, 1500 + i * 10
  from generate_series(1, 12) as g(i);

-- Six fixtures, all ahead of us, all in the one competition.
insert into public.fixtures
  (id, gameweek_id, competition_id, home_team_id, away_team_id, kickoff_at, status, provider_fixture_id)
select ('cccccccc-0000-0000-0000-00000000000' || i)::uuid,
       'aaaaaaaa-0000-0000-0000-000000000003',
       (select id from public.competitions where code = 'EL1'),
       ('bbbbbbbb-0000-0000-0000-' || lpad((i * 2 - 1)::text, 12, '0'))::uuid,
       ('bbbbbbbb-0000-0000-0000-' || lpad((i * 2)::text, 12, '0'))::uuid,
       now() + interval '1 day', 'scheduled', 7000 + i
  from generate_series(1, 6) as g(i);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select ('dddddddd-0000-0000-0000-00000000000' || i)::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p' || i || '@example.com', 'x', now(), now(), now()
  from generate_series(1, 4) as g(i);

update public.profiles set display_name = 'Player ' || right(id::text, 1)
 where id::text like 'dddddddd%';
update public.profiles set is_admin = true
 where id = 'dddddddd-0000-0000-0000-000000000004';

insert into public.leagues (id, name, owner_id, join_code)
values ('eeeeeeee-0000-0000-0000-000000000001', 'Test League',
        'dddddddd-0000-0000-0000-000000000001', 'TEST01');

insert into public.divisions (id, league_id, name, tier, season_id)
values ('ffffffff-0000-0000-0000-000000000001',
        'eeeeeeee-0000-0000-0000-000000000001', 'Division 1', 1,
        (select id from public.seasons where is_active));

insert into public.league_members (league_id, user_id)
select 'eeeeeeee-0000-0000-0000-000000000001',
       ('dddddddd-0000-0000-0000-00000000000' || i)::uuid
  from generate_series(1, 3) as g(i);

insert into public.division_members (division_id, user_id, league_id, season_id, seat)
select 'ffffffff-0000-0000-0000-000000000001',
       ('dddddddd-0000-0000-0000-00000000000' || i)::uuid,
       'eeeeeeee-0000-0000-0000-000000000001',
       (select id from public.seasons where is_active),
       i - 1
  from generate_series(1, 3) as g(i);


-- A finished draft: three players, two picks each, turn past the end.
insert into public.drafts
  (id, division_id, gameweek_id, status, pick_order, current_turn,
   picks_per_player, turn_started_at, turn_expires_at)
values ('99999999-0000-0000-0000-000000000001',
        'ffffffff-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000003',
        'complete',
        array['dddddddd-0000-0000-0000-000000000001',
              'dddddddd-0000-0000-0000-000000000002',
              'dddddddd-0000-0000-0000-000000000003']::uuid[],
        3, 2, now(), null);

insert into public.picks
  (draft_id, user_id, fixture_id, predicted_outcome, pick_number, is_auto_pick)
values
  ('99999999-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','HOME',0,false),
  ('99999999-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002','HOME',1,false),
  ('99999999-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000003','AWAY',2,false),
  ('99999999-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000004','AWAY',3,false),
  ('99999999-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000003','cccccccc-0000-0000-0000-000000000005','DRAW',4,false),
  ('99999999-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000003','cccccccc-0000-0000-0000-000000000006','DRAW',5,false);

commit;
