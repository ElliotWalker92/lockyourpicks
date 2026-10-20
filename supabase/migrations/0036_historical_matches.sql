-- ============================================================
--  0036 — keep last season instead of re-fetching it every week
--
--  Elo is recomputed from scratch each week: seed every club by its
--  division, then replay last season and this one in date order. Replaying
--  from scratch is deliberate — nudging ratings after each result drifts,
--  and a missed or double-applied run is invisible and permanent.
--
--  Last season came from the provider every single time. Six competitions,
--  a season of fixtures each, every Tuesday, for data that cannot change.
--  The provider's per-minute ceiling is enforced per IP and Workers share
--  outbound addresses, so a run gets refused partway through, the history
--  is incomplete, and the job correctly declines to write. Ratings have not
--  updated since 28 September for exactly this reason.
--
--  A finished season is immutable, so it is fetched once and kept. The
--  weekly run then needs no provider calls at all for history, which takes
--  the job out from under the ceiling rather than negotiating with it.
--
--  Two tables, because "we have some rows" and "we have the whole season"
--  are different claims. A fetch refused halfway leaves rows behind; only
--  the marker says a season is actually complete, and it is written last.
--  Without it a partial import would look like a cache hit forever, which
--  is the same wrong ratings this is meant to prevent, made permanent.
--
--  These are not fixtures. They have no gameweek, nobody drafts them, and
--  putting them in `fixtures` would mean every query that means "a match
--  somebody can pick" had to start excluding them.
-- ============================================================

create table if not exists public.historical_matches (
  competition_id      uuid not null references public.competitions(id) on delete cascade,
  season              integer not null,
  -- The provider's own id, so a re-import updates rather than duplicates.
  provider_fixture_id bigint primary key,
  home_team_id        uuid not null references public.teams(id) on delete cascade,
  away_team_id        uuid not null references public.teams(id) on delete cascade,
  home_score          integer not null,
  away_score          integer not null,
  kicked_off_at       timestamptz not null
);

create index if not exists historical_matches_season
  on public.historical_matches (season, competition_id);

comment on table public.historical_matches is
  'Finished matches from a completed season, kept so Elo can replay history without asking the provider again. Not fixtures: no gameweek, nobody picks them.';


create table if not exists public.historical_imports (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  season         integer not null,
  imported_at    timestamptz not null default now(),
  match_count    integer not null,
  primary key (competition_id, season)
);

comment on table public.historical_imports is
  'One row per competition-season fully imported. Written after the rows, so a refused fetch leaves no claim that the season is complete.';


alter table public.historical_matches enable row level security;
alter table public.historical_imports enable row level security;

-- No policies on purpose. Nothing in the app reads these; only the Elo job
-- does, with the service role, which bypasses RLS.
