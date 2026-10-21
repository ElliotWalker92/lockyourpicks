-- ============================================================
--  0043 — a competition says what its clubs are worth
--
--  Elo seeds every club by its division before replaying history, and the
--  map of division to starting rating lived in src/lib/ingest/elo.ts as
--  TIER_SEED: {1: 1500, 2: 1350, 3: 1220, 4: 1120}. Two problems with that
--  now that a league can play more than the English six.
--
--  The first is that it is keyed on `tier`, and `tier` means position in the
--  English pyramid. It is also what the board sorts fixtures by — Premier
--  League, Championship, League One, League Two, cups last. Giving La Liga
--  `tier = 1` to seed it would put it above the Championship in every
--  fixture list, so the one column was being asked to answer two unrelated
--  questions.
--
--  The second is the one this schema keeps getting bitten by: it is a rule
--  about competitions that lives somewhere other than the competitions
--  table, and the only copy. Adding a competition meant remembering to edit
--  a TypeScript constant, and forgetting would seed its clubs at
--  DEFAULT_SEED silently.
--
--  So the level moves onto the row. `tier` goes back to meaning order and
--  nothing else, and `elo_seed` says what we assume about a club we have no
--  results for. Null means the competition says nothing about level, which
--  is the honest answer for a domestic cup: a club's level comes from the
--  division it plays in, not from the fact it entered the FA Cup.
--
--  These are starting points, not claims. A seed is what a club is worth
--  before we have seen it play; it washes out as results arrive, and until
--  there are five of them for a club with no division of ours we show no
--  rating at all (0041). The numbers are anchored on the live scale, where
--  Manchester City sits near 1690 and a mid-table Premier League side near
--  1500.
-- ============================================================

alter table public.competitions
  add column if not exists elo_seed integer;

comment on column public.competitions.elo_seed is
  'Starting Elo for a club we hold no results for, from the level of this competition. Null means the competition says nothing about level — a domestic cup, where the club''s division is what counts. Replaces the TIER_SEED map that used to live in elo.ts.';

-- The English pyramid, unchanged from TIER_SEED. The two cups stay null:
-- entering the FA Cup says nothing about how good a club is.
update public.competitions set elo_seed = 1500 where code = 'PL';
update public.competitions set elo_seed = 1350 where code = 'ELC';
update public.competitions set elo_seed = 1220 where code = 'EL1';
update public.competitions set elo_seed = 1120 where code = 'EL2';


-- ------------------------------------------------------------
--  What else a league can turn on
-- ------------------------------------------------------------
--
--  is_core false, so no existing league sees any of it and a new one has to
--  ask. sets_calendar false, so none of it can move a gameweek boundary —
--  the whole point of 0039. tier null, so none of it jostles the English
--  four in the fixture list; they sort after them, with the cups.
--
--  Nothing is fetched from the provider until some league actually turns one
--  on: `competitions_in_play()` (0042) is what the jobs ask, and it wants a
--  competition to be core or wanted by somebody.
--
--  The European competitions carry a seed of their own, which the domestic
--  leagues here would otherwise have to supply. A group can turn on the
--  Champions League without turning on La Liga, and then Real Madrid is a
--  club we hold no league fixtures for — so "a side that qualified for this"
--  is the only thing we know about it, and it is worth something: not as
--  good as the rating it will have once it has played, better than nothing.
insert into public.competitions
  (provider_league_id, code, name, tier, is_cup, is_active, is_core, sets_calendar, elo_seed)
values
  (  2, 'UCL',  'UEFA Champions League',         null, true,  true, false, false, 1500),
  (  3, 'UEL',  'UEFA Europa League',            null, true,  true, false, false, 1380),
  (848, 'UECL', 'UEFA Conference League',        null, true,  true, false, false, 1250),
  (140, 'LLA',  'La Liga',                       null, false, true, false, false, 1500),
  (135, 'SA',   'Serie A',                       null, false, true, false, false, 1480),
  ( 78, 'BUN',  'Bundesliga',                    null, false, true, false, false, 1470),
  ( 61, 'L1',   'Ligue 1',                       null, false, true, false, false, 1400),
  ( 88, 'ERE',  'Eredivisie',                    null, false, true, false, false, 1300),
  ( 94, 'PRI',  'Primeira Liga',                 null, false, true, false, false, 1300),
  (179, 'SPFL', 'Scottish Premiership',          null, false, true, false, false, 1200),
  ( 43, 'NL',   'National League',               null, false, true, false, false, 1000)
on conflict (provider_league_id) do nothing;


-- ------------------------------------------------------------
--  Seeds, per club, in one answer
-- ------------------------------------------------------------
--
--  The job used to ask for every fixture in each competition in turn to work
--  out which clubs play where — one request per competition, against a
--  Workers ceiling of fifty per invocation. Six was comfortable; seventeen
--  on top of everything else the job does is not a margin worth keeping.
--
--  A club in both a domestic league and a European competition takes the
--  league's seed: "plays in the Eredivisie" is a better guide than
--  "qualified for the Europa League", and the old code's answer depended on
--  which competition the loop reached last. Where there is only a cup to go
--  on, the lowest of them — the conservative read on a club we have not
--  seen.
create or replace function public.team_elo_seeds()
returns table (team_id uuid, elo_seed integer)
language sql stable security definer set search_path = public as $$
  select s.team_id,
         coalesce(
           min(s.seed) filter (where not s.is_cup),
           min(s.seed)
         )::integer as elo_seed
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
grant execute on function public.team_elo_seeds() to authenticated, service_role;
