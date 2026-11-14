-- ============================================================
--  A postponed pick rides to the rearranged date
--
--  0062 released the picks on any fixture that went off. That is right for
--  one case and wrong for the other, and the two look identical from the
--  status change alone:
--
--    1. The game was already called off when they picked it, and our data
--       had not caught up. They have spent a pick on nothing. Give it back
--       and tell them to pick again.
--
--    2. The game was genuinely on when they picked it and was called off
--       afterwards. That is the luck of the draw, not a mistake, and the
--       pick should follow the fixture to whenever it is replayed and score
--       then. Taking it away punishes them for the fixture list changing.
--
--  Case 2 is what the spreadsheet always did, and it is what the data
--  already does by accident: the provider keeps the same fixture id and
--  moves the date, our ingest upserts on provider_fixture_id and recomputes
--  the gameweek from the kickoff, so the fixture moves and the pick moves
--  with it. Four picks this season have been scored that way, two of them
--  for a point.
--
--  What tells the cases apart is whether the fixture was *already known*
--  to be off when the pick was made, so this writes that down.
--  `postponed_at` is the first time we saw it off and is not moved by
--  seeing it again — which matters, because the way case 1 actually
--  happened was the ingest wrongly putting six called-off games back on
--  the board (the fault 0061 fixed), four players picking them, and the
--  ingest then agreeing they were off after all. Stamping the latest
--  sighting would lose exactly the fact that matters.
--
--  Two consequences follow for settlement:
--
--    * A postponed pick is no longer scored zero. It is pending, because
--      the match is going to be played. Cancelled still scores zero —
--      nothing is coming.
--
--    * A gameweek total is a stored sum written once when that gameweek
--      settles, and `settle_due_gameweeks` never revisits a settled one. So
--      a point earned on a rearranged date lands in `picks` and never
--      reaches the table. It has happened once already: VladOd called
--      Barnet v York, drafted in gameweek 13, played in gameweek 19, and
--      the point is in his pick and missing from his total.
--      `rescore_stale_gameweeks` is the fix, and it is a comparison rather
--      than a trigger because the write that needs chasing is three weeks
--      and two gameweeks away from the row it invalidates.
-- ============================================================

-- ------------------------------------------------------------
--  When we first saw it was off
-- ------------------------------------------------------------
alter table public.fixtures
  add column if not exists postponed_at timestamptz;

comment on column public.fixtures.postponed_at is
  'The first time this fixture was seen postponed or cancelled. Not moved '
  'by later sightings: a pick made after this was made on a game already '
  'known to be off, and only those are given back. Cleared when an admin '
  'deliberately puts the fixture back on, which says the postponement was '
  'wrong.';

-- Backfill with *now*, not with a date in the past.
--
-- The column reads "we knew it was off from here", and a pick made after
-- that point is the one that gets given back. Stamping a fixture that is
-- already off with an old date would therefore mark every existing pick on
-- it as made in bad faith and hand them all back — the exact opposite of
-- the rule above. Stamping it with now means every pick that already
-- exists was made before we knew, so they all ride, which is right: the
-- one live case is Pierre's Doncaster pick, made on the 9th, four days
-- before the provider said a word.
update public.fixtures
   set postponed_at = coalesce(postponed_at, now())
 where status in ('postponed', 'cancelled');


create or replace function public.stamp_fixture_postponed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Runs after 0061's guard, which may have put NEW.status back to what it
  -- was — triggers of the same timing fire in name order, and
  -- fixtures_keep_admin_status sorts before fixtures_stamp_postponed. So
  -- this sees the status that is actually going to be stored.
  if NEW.status in ('postponed', 'cancelled') then
    if OLD.postponed_at is null then
      NEW.postponed_at := now();
    end if;
  elsif NEW.status = 'scheduled'
        and coalesce(current_setting('app.fixture_admin', true), '') = 'on' then
    -- Only a person putting it back means "that postponement was wrong".
    -- The feed changing its mind is just the feed, and forgetting the
    -- first sighting would hand back picks that should ride.
    NEW.postponed_at := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists fixtures_stamp_postponed on public.fixtures;
create trigger fixtures_stamp_postponed
  before update of status on public.fixtures
  for each row execute procedure public.stamp_fixture_postponed();


-- ------------------------------------------------------------
--  Give back only what was picked on a game already known to be off
-- ------------------------------------------------------------
create or replace function public.release_picks_on_fixture(p_fixture_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_released integer;
begin
  with gone as (
    delete from public.picks p
     using public.drafts d, public.gameweeks g, public.fixtures f
     where p.fixture_id = p_fixture_id
       and f.id = p.fixture_id
       and d.id = p.draft_id
       and g.id = d.gameweek_id
       -- A round that has closed is history: they could not pick again
       -- anyway, and reopening it would rewrite a settled table.
       and g.draft_closes_at > now()
       -- The whole of the rule. A pick made before we knew the game was
       -- off rides to the rearranged date; a pick made after we knew comes
       -- back.
       and f.postponed_at is not null
       and p.created_at > f.postponed_at
    returning p.draft_id, p.user_id, p.fixture_id, p.predicted_outcome
  )
  insert into public.pick_releases (draft_id, user_id, fixture_id, outcome)
  select draft_id, user_id, fixture_id, predicted_outcome from gone;

  get diagnostics v_released = row_count;
  return v_released;
end;
$$;

revoke all on function public.release_picks_on_fixture(uuid) from public, anon, authenticated;


-- ------------------------------------------------------------
--  Writing a gameweek's totals, in one place
--
--  Lifted out of settle_gameweek so the rescore below cannot drift from
--  it. Two copies of this aggregate is two answers to "what did they
--  score", and the one nobody is looking at would be the one on the table.
-- ------------------------------------------------------------
create or replace function public.write_gameweek_scores(p_gameweek_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_rows integer;
begin
  insert into public.gameweek_scores
    (user_id, gameweek_id, division_id, points, correct_count, settled_at)
  select p.user_id,
         p_gameweek_id,
         d.division_id,
         coalesce(sum(p.points_awarded), 0),
         coalesce(sum(p.points_awarded), 0),
         now()
    from public.picks p
    join public.drafts d on d.id = p.draft_id
   where d.gameweek_id = p_gameweek_id
   group by p.user_id, d.division_id
  on conflict (user_id, gameweek_id, division_id) do update
     set points        = excluded.points,
         correct_count = excluded.correct_count,
         settled_at    = excluded.settled_at;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.write_gameweek_scores(uuid) from public, anon, authenticated;


-- ------------------------------------------------------------
--  settle_gameweek: a postponed pick is pending, not nil
-- ------------------------------------------------------------
create or replace function public.settle_gameweek(p_gameweek_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_scored  integer;
  v_pending integer;
  v_gw      public.gameweeks%rowtype;
  v_next    public.gameweeks%rowtype;
begin
  select * into v_gw from public.gameweeks where id = p_gameweek_id;
  if not found then raise exception 'Gameweek not found'; end if;

  update public.picks p
     set points_awarded = case when p.predicted_outcome = f.result then 1 else 0 end
    from public.fixtures f
   where p.fixture_id  = f.id
     and f.gameweek_id = p_gameweek_id
     and f.status      = 'finished'
     and f.result is not null;

  get diagnostics v_scored = row_count;

  -- Cancelled only. A postponed match is going to be played, and the pick
  -- on it is pending until it is — scoring it zero now is a guess that
  -- becomes permanent, because a settled gameweek is never revisited.
  update public.picks p
     set points_awarded = 0
    from public.fixtures f
   where p.fixture_id  = f.id
     and f.gameweek_id = p_gameweek_id
     and f.status      = 'cancelled'
     and p.points_awarded is null;

  perform public.write_gameweek_scores(p_gameweek_id);

  -- Only fixtures somebody could have taken. A competition we follow purely
  -- to rate its clubs has nothing to do with whether this round is over.
  select count(*) into v_pending
    from public.fixtures f
    join public.competitions c on c.id = f.competition_id
   where f.gameweek_id = p_gameweek_id
     and f.status not in ('finished', 'postponed', 'cancelled')
     and (
       c.is_core
       or exists (
         select 1 from public.league_competitions lc
          where lc.competition_id = f.competition_id
       )
     );

  if v_pending = 0 then
    update public.gameweeks
       set status = 'settled'
     where id = p_gameweek_id;

    select * into v_next
      from public.gameweeks
     where season_id = v_gw.season_id
       and number    > v_gw.number
       and status   <> 'settled'
     order by number
     limit 1;

    if found and v_next.draft_closes_at > now() then
      perform public.start_drafts_for_gameweek(v_next.id);
    end if;
  end if;

  return v_scored;
end;
$$;

revoke all on function public.settle_gameweek(uuid) from public, anon, authenticated;
grant execute on function public.settle_gameweek(uuid) to service_role;


-- ------------------------------------------------------------
--  Totals that have gone stale, because a pick scored late
-- ------------------------------------------------------------
create or replace function public.rescore_stale_gameweeks()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_fixed integer := 0;
begin
  for v_id in
    select s.gameweek_id
      from public.gameweek_scores s
      left join (
        select d.gameweek_id, p.user_id, d.division_id,
               coalesce(sum(p.points_awarded), 0) as points
          from public.picks p
          join public.drafts d on d.id = p.draft_id
         group by d.gameweek_id, p.user_id, d.division_id
      ) live
        on  live.gameweek_id = s.gameweek_id
        and live.user_id     = s.user_id
        and live.division_id = s.division_id
     where coalesce(live.points, 0) <> s.points
     group by s.gameweek_id
  loop
    perform public.write_gameweek_scores(v_id);
    v_fixed := v_fixed + 1;
  end loop;

  return v_fixed;
end;
$$;

revoke all on function public.rescore_stale_gameweeks() from public, anon, authenticated;
grant execute on function public.rescore_stale_gameweeks() to service_role;
