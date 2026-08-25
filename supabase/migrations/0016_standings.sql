-- ============================================================
--  0016 — real league tables
--
--  The app's own table ranks players. This one ranks clubs: the actual
--  Premier League, Championship, League One and League Two standings, as
--  the provider reports them.
--
--  Stored rather than fetched on request. A page that called the provider
--  on every view would be slow, rate-limited and broken whenever the API
--  was, and the data only changes when matches finish.
--
--  The home and away splits are kept as well as the totals. They are the
--  part a single Elo number flattens — a side strong at home and poor away
--  reads as mid-table either way — so they're worth having for the
--  prediction model later even though the page shows the combined row.
-- ============================================================

create table if not exists public.standings (
  competition_id uuid not null references public.competitions(id) on delete cascade,
  season_id      uuid not null references public.seasons(id) on delete cascade,
  team_id        uuid not null references public.teams(id) on delete cascade,

  rank           integer not null,
  points         integer not null,
  goals_diff     integer not null,

  played         integer not null default 0,
  win            integer not null default 0,
  draw           integer not null default 0,
  lose           integer not null default 0,
  goals_for      integer not null default 0,
  goals_against  integer not null default 0,

  home_played        integer not null default 0,
  home_win           integer not null default 0,
  home_draw          integer not null default 0,
  home_lose          integer not null default 0,
  home_goals_for     integer not null default 0,
  home_goals_against integer not null default 0,

  away_played        integer not null default 0,
  away_win           integer not null default 0,
  away_draw          integer not null default 0,
  away_lose          integer not null default 0,
  away_goals_for     integer not null default 0,
  away_goals_against integer not null default 0,

  -- 'WWDLW', most recent last.
  form           text,
  -- 'up' | 'down' | 'same' — movement since the last round.
  status         text,
  -- Free text from the provider: 'Promotion - Premier League',
  -- 'Relegation - League Two'. What colours the zones on the page.
  description    text,

  updated_at     timestamptz not null default now(),

  primary key (competition_id, season_id, team_id)
);

create index if not exists standings_lookup_idx
  on public.standings (competition_id, season_id, rank);

alter table public.standings enable row level security;

-- Reference data: readable by anyone, written only by the ingest.
drop policy if exists "standings: read" on public.standings;
create policy "standings: read"
  on public.standings for select using (true);

drop policy if exists "standings: admin writes" on public.standings;
create policy "standings: admin writes"
  on public.standings for all
  using (public.is_admin()) with check (public.is_admin());

grant select on public.standings to anon, authenticated;
