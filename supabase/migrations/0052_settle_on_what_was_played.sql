-- ============================================================
--  0052 — a gameweek is finished when its own fixtures are
--
--  settle_gameweek decides whether a gameweek is done by counting what is
--  left in it:
--
--    select count(*) into v_pending from public.fixtures
--     where gameweek_id = p_gameweek_id
--       and status not in ('finished', 'postponed', 'cancelled');
--
--  Every fixture in the block. Until 0049 that was every fixture anybody
--  could pick; since the six ratings leagues it includes matches no board
--  shows and no pick references. So a gameweek now stays open until the last
--  Spanish, Italian, German, French, Dutch or Portuguese fixture in its week
--  has been played — and the gameweek settling is what opens the next one.
--
--  Measured against the real card, eight of the next ten gameweeks would
--  settle late:
--
--    GW18   22h, held by Serie A          GW23  146h, held by Ligue 1
--    GW19   24h, held by the Bundesliga   GW25   24h, held by Ligue 1
--    GW21   48h, held by Serie A          GW26   28h, held by the Primeira
--    GW22    4h, held by the Primeira     GW27   47h, held by the Eredivisie
--
--  Six days for GW23. And the next gameweek is only opened when the previous
--  one settles, with `draft_closes_at > now()` as the guard — so a long
--  enough delay does not open it late, it fails to open it at all and the
--  season stops.
--
--  Scoring was never affected and is not touched here: both update
--  statements join picks to fixtures, and a pick is only ever on a fixture
--  its round allowed. Points have been landing correctly throughout. It is
--  the status flip, and the progression that hangs off it, that was wrong.
--
--  Core is tested as well as league membership for the same reason as 0048
--  and the results health check: core is seeded into every league, but on a
--  database with no leagues membership alone counts nothing, and a gameweek
--  that settles because it contains nothing is worse than one that waits.
-- ============================================================

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

  update public.picks p
     set points_awarded = 0
    from public.fixtures f
   where p.fixture_id  = f.id
     and f.gameweek_id = p_gameweek_id
     and f.status in ('postponed', 'cancelled')
     and p.points_awarded is null;

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
  -- Matches the group by. Keyed on the player alone, somebody in two
  -- divisions produced two rows aimed at one, and the statement failed
  -- for everybody rather than only for them.
  on conflict (user_id, gameweek_id, division_id) do update
     set points        = excluded.points,
         correct_count = excluded.correct_count,
         settled_at    = excluded.settled_at;

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
