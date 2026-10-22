-- ============================================================
--  0049 — competitions we follow but nobody plays
--
--  The European clubs are badly rated and the hedge in 0047 only limits the
--  damage: Real Madrid at 1431, below Aston Villa, because his only results
--  are Champions League matches against other clubs we cannot place either.
--  The fix is 38 La Liga results a season. The objection to that was that
--  nobody wants La Liga fixtures on their board.
--
--  Those are two different questions, and they only looked like one because
--  until now anything we fetched was something somebody played. Ingesting a
--  competition tells the model what its clubs are worth. Offering it to a
--  league decides what people can pick. Nothing requires both.
--
--  So `ratings_only`: fetched, replayed, never offered. The six leagues that
--  between them hold most of the Champions League field go in the
--  background. Their clubs get a division of ours, so they stop being
--  provisional and start carrying real ratings, and no board changes.
--
--  Three things keep "never offered" true rather than remembered:
--  competitions_in_play() still fetches it, the competitions the owner is
--  shown exclude it, and a trigger refuses a league_competitions row for one
--  outright. The last is what makes it a guarantee instead of a convention.
--
--  What this does not fix: the clubs outside those six leagues — Bodo/Glimt,
--  Galatasaray, Slavia Praha, Shakhtar, Sabah, Viking, Union St. Gilloise
--  and the rest. They stay provisional, which is what the hedge is for. We
--  could follow another dozen leagues to place them and it would cost a
--  dozen provider calls a week to price fixtures a handful of people might
--  look at once.
--
--  Cost of these six: six more /fixtures calls on the weekly ingest, six
--  last seasons fetched once and stored, around 1,800 more fixtures in the
--  table that no board will query. Elo declines to write while any history
--  is missing, so expect the first run or two after this to import rather
--  than rate.
-- ============================================================

alter table public.competitions
  add column if not exists ratings_only boolean not null default false;

comment on column public.competitions.ratings_only is
  'Followed so Elo can place this competition''s clubs, never offered to a league. Not shown on the owner''s page, refused by set_league_competitions, and a trigger blocks a league_competitions row for it.';

-- The six that hold most of the Champions League field. Scotland and the
-- National League stay opt-in: a group might actually want to play those.
update public.competitions
   set ratings_only = true
 where code in ('LLA', 'SA', 'BUN', 'L1', 'ERE', 'PRI');


-- ------------------------------------------------------------
--  Never offered, by construction
-- ------------------------------------------------------------
create or replace function public.block_ratings_only_competitions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.competitions c
     where c.id = new.competition_id and c.ratings_only
  ) then
    raise exception
      'That competition is followed for ratings only and cannot be played.';
  end if;
  return new;
end;
$$;

drop trigger if exists league_competitions_block_ratings_only
  on public.league_competitions;
create trigger league_competitions_block_ratings_only
  before insert on public.league_competitions
  for each row execute function public.block_ratings_only_competitions();

-- Anything already opted in before this ran would now be unplayable, so it
-- goes. Nothing has — these six were only added a few hours ago and nobody
-- has turned one on — but a migration that assumes that is a migration that
-- is wrong the second time it is used.
delete from public.league_competitions lc
 where exists (
   select 1 from public.competitions c
    where c.id = lc.competition_id and c.ratings_only
 );


-- ------------------------------------------------------------
--  Still worth fetching
-- ------------------------------------------------------------
--
--  Same rule as 0042 with the third case: core, or wanted by a league, or
--  followed for ratings.
create or replace function public.competitions_in_play()
returns setof public.competitions
language sql stable security definer set search_path = public as $$
  select c.* from public.competitions c
   where c.is_active
     and (
       c.is_core
       or c.ratings_only
       or exists (
         select 1 from public.league_competitions lc
          where lc.competition_id = c.id
       )
     )
   order by c.is_core desc, c.tier nulls last, c.code;
$$;

revoke all on function public.competitions_in_play() from public, anon;
grant execute on function public.competitions_in_play() to authenticated, service_role;


-- ------------------------------------------------------------
--  Refused politely at the front door too
-- ------------------------------------------------------------
--
--  Same function as 0044 with ratings_only rejected by name. The trigger
--  above would stop it anyway, but "That competition is followed for ratings
--  only" from a trigger deep in an insert is a worse message than one the
--  function can give while naming what was asked for.
create or replace function public.set_league_competitions(
  p_league_id uuid,
  p_competition_ids uuid[]
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_league public.leagues%rowtype;
  v_codes  text[];
begin
  if v_uid is null then
    raise exception 'You need to be signed in.';
  end if;

  select * into v_league from public.leagues where id = p_league_id;
  if not found then
    raise exception 'Group not found.';
  end if;

  if not (v_league.owner_id = v_uid or public.is_admin()) then
    raise exception 'Only the group owner can change this.';
  end if;

  -- Nulls out of the array first: `x <> all (array[...])` yields null for a
  -- null element, so the delete below would silently keep every row.
  p_competition_ids := coalesce(
    (select array_agg(x) from unnest(p_competition_ids) x where x is not null),
    '{}'::uuid[]
  );

  select array_agg(x::text) into v_codes
    from unnest(p_competition_ids) x
   where not exists (
     select 1 from public.competitions c
      where c.id = x and c.is_active and not c.ratings_only
   );
  if v_codes is not null then
    raise exception 'Not a competition you can play: %',
      array_to_string(v_codes, ', ');
  end if;

  insert into public.league_competitions (league_id, competition_id)
  select p_league_id, c.id from public.competitions c where c.is_core
  on conflict do nothing;

  insert into public.league_competitions (league_id, competition_id)
  select p_league_id, x from unnest(p_competition_ids) x
  on conflict do nothing;

  delete from public.league_competitions lc
   where lc.league_id = p_league_id
     and lc.competition_id <> all (p_competition_ids)
     and not exists (
       select 1 from public.competitions c
        where c.id = lc.competition_id and c.is_core
     );

  select array_agg(c.code order by c.is_core desc, c.tier nulls last, c.code)
    into v_codes
    from public.league_competitions lc
    join public.competitions c on c.id = lc.competition_id
   where lc.league_id = p_league_id;

  return jsonb_build_object('competitions', v_codes);
end;
$$;

revoke all on function public.set_league_competitions(uuid, uuid[]) from public, anon;
grant execute on function public.set_league_competitions(uuid, uuid[]) to authenticated;
