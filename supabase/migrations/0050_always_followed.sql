-- ============================================================
--  0050 — following a competition is not the opposite of offering it
--
--  0049 added `ratings_only` for the six leagues that place the Champions
--  League field, and it did two things at once: followed them whether or not
--  anybody played them, and made them unpickable. The first is what was
--  wanted. The second was me reading "not shown to leagues" as "cannot be
--  chosen" rather than "not forced on anybody", and it took La Liga, Serie
--  A, the Bundesliga, Ligue 1, the Eredivisie and the Primeira Liga off the
--  owner's list, where they had been available since 0043.
--
--  They are independent questions, and the whole point of 0049 was that they
--  are:
--
--    followed  — we fetch it and Elo replays it, so its clubs get placed
--    offered   — a group may put it on its board
--
--  `is_core` is followed and compulsory. `always_followed` is followed and
--  optional. Everything else is followed only while some group plays it.
--  Nothing is followed-and-forbidden any more, which is a state that had no
--  reason to exist.
--
--  So the column is renamed to say what it means, the trigger that refused a
--  league_competitions row for one goes, and set_league_competitions stops
--  rejecting them. The six are back on the owner's list and still rated in
--  the background whether anybody takes them or not.
-- ============================================================

alter table public.competitions
  rename column ratings_only to always_followed;

comment on column public.competitions.always_followed is
  'Fetched and replayed whether or not any league plays it, so Elo can place its clubs — the six leagues that hold most of the European field. Says nothing about whether it can be played: that is is_core for compulsory, a league_competitions row for chosen.';

-- Nothing is unplayable any more. The guard this drops was the mistake.
drop trigger if exists league_competitions_block_ratings_only
  on public.league_competitions;
drop function if exists public.block_ratings_only_competitions();


-- ------------------------------------------------------------
--  Still worth fetching
-- ------------------------------------------------------------
--
--  Same three cases as 0049 under the new name.
create or replace function public.competitions_in_play()
returns setof public.competitions
language sql stable security definer set search_path = public as $$
  select c.* from public.competitions c
   where c.is_active
     and (
       c.is_core
       or c.always_followed
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
--  Which competitions a league can be put on
-- ------------------------------------------------------------
--
--  Back to 0044's rule: active, and not already compulsory. Being followed
--  for ratings is no longer a reason to refuse.
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
     select 1 from public.competitions c where c.id = x and c.is_active
   );
  if v_codes is not null then
    raise exception 'Not a competition we offer: %', array_to_string(v_codes, ', ');
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
