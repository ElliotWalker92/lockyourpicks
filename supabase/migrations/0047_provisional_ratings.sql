-- ============================================================
--  0047 — a rating that is really still a guess, and says so
--
--  Boboli turned the Champions League on, the Elo job imported last
--  season's, and the European clubs came out like this:
--
--    Arsenal      1667      Real Madrid  1431      Sabah FA      1389
--    Man City     1667      Atletico     1420      Viking        1388
--    Aston Villa  1543      Bodo/Glimt   1419      Inter         1369
--
--  Real Madrid below Aston Villa and forty points above Sabah FA. The whole
--  European field sits between 1350 and 1500, which is the 1400 seed plus
--  noise, because their only results are Champions League matches against
--  each other: around ten games at K=20 cannot separate them, and there are
--  too few English-against-European ties to tie the two scales together.
--
--  The five-result bar from 0041 passes them, which is the hole. It was
--  written for an English non-league club, where results *do* anchor you —
--  the opponent in an FA Cup tie is a club we rate on our own scale. Two
--  clubs we cannot place beating each other tells us nothing about where
--  either sits.
--
--  Rating them anyway and saying nothing would have the model call Arsenal
--  v Real Madrid near-certain off a guess. Refusing to rate them at all
--  would leave a group that opted in with no read on the fixtures they
--  opted in for. So the rating stands and carries a caveat: `elo_provisional`
--  is true for a club with no division of ours to place it, and the model
--  gives that layer a third of its usual weight and labels it on screen.
--
--  The caveat is the club's, not the fixture's: Arsenal v Real Madrid is
--  provisional because of Real Madrid, and the panel says which side it
--  cannot place.
--
--  It clears itself. The day a group turns La Liga on, Real Madrid has a
--  division of ours, 38 league results a season, and an ordinary rating.
-- ============================================================

alter table public.teams
  add column if not exists elo_provisional boolean not null default false;

comment on column public.teams.elo_provisional is
  'The rating rests on a seed and results we cannot anchor — a club with no division of ours, known only from a cup. The model weights it down and says so. Written by the Elo job; nothing is backfilled here, running the job applies it.';


-- ------------------------------------------------------------
--  Seeds now say where they came from
-- ------------------------------------------------------------
--
--  Same query as 0043 with the one extra fact the caller needs: whether any
--  of the competitions behind this club's seed was a league rather than a
--  cup. A league places a club; entering a cup does not.
--
--  Dropped first, not replaced. `create or replace` cannot change a
--  function's return type, and this adds a column to it — Postgres raises
--  "cannot change return type of existing function", which inside the
--  transaction the SQL editor wraps a script in takes the alter table above
--  down with it. 0042 got this right for fixture_floor and this did not.
drop function if exists public.team_elo_seeds();

create or replace function public.team_elo_seeds()
returns table (team_id uuid, elo_seed integer, from_league boolean)
language sql stable security definer set search_path = public as $$
  select s.team_id,
         coalesce(
           min(s.seed) filter (where not s.is_cup),
           min(s.seed)
         )::integer as elo_seed,
         bool_or(not s.is_cup) as from_league
    from (
      select f.home_team_id as team_id, c.elo_seed as seed, c.is_cup
        from public.fixtures f
        join public.competitions c on c.id = f.competition_id
       where c.elo_seed is not null
      union all
      select f.away_team_id, c.elo_seed, c.is_cup
        from public.fixtures f
        join public.competitions c on c.id = f.competition_id
       where c.elo_seed is not null
    ) s
   group by s.team_id;
$$;

revoke all on function public.team_elo_seeds() from public, anon;
grant execute on function public.team_elo_seeds()
  to authenticated, service_role;


-- ------------------------------------------------------------
--  Writing it
-- ------------------------------------------------------------
--
--  Same function as 0041 with the caveat carried alongside the rating, so
--  the two can never disagree about a club. A cleared rating is never
--  provisional — there is nothing there to qualify.
create or replace function public.apply_team_elo(p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update public.teams t
     set elo_rating      = (e->>'elo_rating')::numeric,
         elo_updated_at  = case
                             when e->>'elo_rating' is null then null
                             else now()
                           end,
         elo_provisional = case
                             when e->>'elo_rating' is null then false
                             else coalesce((e->>'provisional')::boolean, false)
                           end
    from jsonb_array_elements(p_rows) e
   where t.id = (e->>'id')::uuid;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.apply_team_elo(jsonb) from public, anon, authenticated;
grant execute on function public.apply_team_elo(jsonb) to service_role;
