-- ============================================================
--  0033 — the global board counts one group per player
--
--  Players can be in more than one group, and the board summed every point
--  they had scored anywhere. Someone in two groups picks twice as often and
--  so scores roughly twice as much, which put them above better players for
--  having joined more. The comparison was between a double-length season
--  and everyone else's single one.
--
--  So each player is counted once, on their strongest group. Not a total
--  across groups, and not a row per group: a single line that says what
--  this player's best run at the season looks like, which is the question
--  the board was always being asked.
--
--  It does discard the rest of what somebody did, and that is the real cost
--  of this choice. The alternative was ranking on points per gameweek,
--  which is fairer still and reads like an accountant's table. The group's
--  own tables are where every point counts; this one is for bragging.
--
--  The counted group comes back with the row so the page can say which one
--  it was. Without that, a player whose two groups both scored sees a total
--  lower than their own arithmetic and has no way to know why.
-- ============================================================

drop view if exists public.global_standings;

create view public.global_standings
with (security_invoker = true) as
with per_league as (
  select
    gw.season_id,
    gs.user_id,
    l.id                             as league_id,
    l.name                           as league_name,
    l.is_open                        as plays_open,
    sum(gs.points)::integer          as points,
    count(*)::integer                as gameweeks_played,
    sum(gs.correct_count)::integer   as correct_count
  from public.gameweek_scores gs
  join public.gameweeks gw   on gw.id = gs.gameweek_id
  join public.divisions d    on d.id  = gs.division_id
  join public.leagues l      on l.id  = d.league_id
  group by gw.season_id, gs.user_id, l.id, l.name, l.is_open
),
counted as (
  select *,
         -- How many groups this player scored in at all, so the page can
         -- explain the number only to the people it needs explaining to.
         count(*) over (partition by season_id, user_id)::integer
           as leagues_played
    from per_league
),
best as (
  select distinct on (season_id, user_id)
    season_id, user_id, league_id, league_name, plays_open,
    points, gameweeks_played, correct_count, leagues_played
  from counted
  -- Most points wins. Level on points, the one that took fewer gameweeks
  -- to get there is the better run; the id only keeps it from flickering
  -- between two identical ones.
  order by season_id, user_id, points desc, gameweeks_played asc, league_id
)
select
  season_id,
  user_id,
  league_id,
  league_name,
  leagues_played,
  plays_open,
  points,
  gameweeks_played,
  correct_count,
  rank() over (
    partition by season_id
    order by points desc
  )::integer as position
from best;

grant select on public.global_standings to anon, authenticated;
