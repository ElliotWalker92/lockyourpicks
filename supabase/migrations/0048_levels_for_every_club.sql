-- ============================================================
--  0048 — the seeds query also has to say who has a fixture
--
--  `unrated` in the Elo report was added in 0041 to mean one thing: a club
--  here that plays in a league we cover means its fixtures are not being
--  ingested. It is now 64, of which 45 are clubs that reached our tables
--  through one botched Champions League import and have no fixture at all,
--  and three more are clubs that played last season's competition and not
--  this one. None of them is reachable from anywhere in the app — nothing
--  surfaces a club except through a fixture — so none of them is a problem
--  worth a line in a report, and between them they drowned the signal.
--
--  Worse, they were still being rated. Union St. Gilloise 1030, Olympiakos
--  1015, Kairat Almaty 993 — DEFAULT_SEED plus a nudge from last season,
--  for clubs nobody can be shown. That is what dragged the report's bottom
--  five into nonsense.
--
--  Both need the same fact: which clubs appear in a fixture at all. The
--  seeds query already walks every fixture, so it answers it for free —
--  it just has to stop throwing away the rows it cannot price. A club in
--  nothing but the FA Cup now gets a row with a null seed instead of no
--  row, which is the honest shape: we have heard of it, and we have no
--  level for it.
--
--  The name stays `team_elo_seeds`, which is a little generous now that a
--  row need not carry a seed. The alternative was a rename rippling through
--  the job and two migrations to say the same thing.
-- ============================================================

drop function if exists public.team_elo_seeds();

create or replace function public.team_elo_seeds()
returns table (team_id uuid, elo_seed integer, from_league boolean)
language sql stable security definer set search_path = public as $$
  select s.team_id,
         -- min() skips nulls, so a club with one priced competition and one
         -- unpriced takes the price. Null only when nothing prices it.
         coalesce(
           min(s.seed) filter (where not s.is_cup),
           min(s.seed)
         )::integer as elo_seed,
         -- A division of ours places a club on our scale. An unpriced
         -- competition places nothing, whether or not it is a cup.
         coalesce(
           bool_or(not s.is_cup and s.seed is not null),
           false
         ) as from_league
    from (
      select f.home_team_id as team_id, c.elo_seed as seed, c.is_cup
        from public.fixtures f
        join public.competitions c on c.id = f.competition_id
      union all
      select f.away_team_id, c.elo_seed, c.is_cup
        from public.fixtures f
        join public.competitions c on c.id = f.competition_id
    ) s
   group by s.team_id;
$$;

comment on function public.team_elo_seeds() is
  'One row per club that appears in any fixture we hold. elo_seed is the level its competitions imply, null when none of them carries one; from_league says whether a priced division of ours placed it, as opposed to a cup. A club with no row here is in no fixture and cannot be shown anywhere in the app.';

revoke all on function public.team_elo_seeds() from public, anon;
grant execute on function public.team_elo_seeds()
  to authenticated, service_role;
