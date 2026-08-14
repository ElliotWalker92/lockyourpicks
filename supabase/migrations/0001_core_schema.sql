-- ============================================================
--  Lock Your Picks v2 — core schema
--  See docs/game-design.md for the game rules this models.
-- ============================================================

create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
--  Enums
-- ------------------------------------------------------------

-- Storage is HOME/DRAW/AWAY. The spreadsheet encodes a prediction as the
-- winning team's *name* (or '-' for a draw); that stays a UI concern — the
-- interface shows team names, the database stores the outcome. Storing a
-- team_id would allow a prediction naming a team that isn't in the fixture.
create type public.outcome as enum ('HOME', 'DRAW', 'AWAY');

create type public.gameweek_status as enum
  ('upcoming', 'drafting', 'locked', 'live', 'settled');

create type public.fixture_status as enum
  ('scheduled', 'live', 'finished', 'postponed', 'cancelled');

create type public.draft_status as enum ('pending', 'active', 'complete');


-- ------------------------------------------------------------
--  profiles — extends auth.users
-- ------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  email         text,
  avatar_color  text        default '#c8f135',
  is_admin      boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ------------------------------------------------------------
--  Reference data: seasons, competitions, teams
-- ------------------------------------------------------------
create table public.seasons (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,              -- '2026/27'
  starts_on  date not null,
  ends_on    date not null,
  is_active  boolean not null default false
);

-- Only one active season at a time.
create unique index seasons_single_active
  on public.seasons ((true)) where is_active;

create table public.competitions (
  id                 uuid primary key default uuid_generate_v4(),
  provider_league_id integer unique,     -- API-Football league id
  code               text not null unique, -- 'PL', 'ELC', 'EL1', 'EL2', 'FAC', 'EFLC'
  name               text not null,
  tier               integer,            -- 1..4 for league pyramid, null for cups
  is_cup             boolean not null default false,
  is_active          boolean not null default true
);

create table public.teams (
  id               uuid primary key default uuid_generate_v4(),
  provider_team_id integer unique,
  name             text not null,
  short_name       text,
  crest_url        text,
  -- Elo carried over from the WC2026 model (legacy/js/elo.js). 1500 = baseline.
  elo_rating       numeric(7,2) not null default 1500,
  elo_updated_at   timestamptz
);

create index teams_name_idx on public.teams (lower(name));


-- ------------------------------------------------------------
--  Gameweeks — the app's own weekly cycle, spanning competitions
-- ------------------------------------------------------------
create table public.gameweeks (
  id              uuid primary key default uuid_generate_v4(),
  season_id       uuid not null references public.seasons(id) on delete cascade,
  number          integer not null,
  name            text,
  draft_opens_at  timestamptz not null,
  draft_closes_at timestamptz not null,   -- first kickoff of the gameweek
  first_kickoff_at timestamptz,
  status          public.gameweek_status not null default 'upcoming',
  unique (season_id, number),
  constraint gameweek_window_valid check (draft_closes_at > draft_opens_at)
);


-- ------------------------------------------------------------
--  Fixtures
-- ------------------------------------------------------------
create table public.fixtures (
  id                  uuid primary key default uuid_generate_v4(),
  provider_fixture_id integer unique,
  gameweek_id         uuid not null references public.gameweeks(id) on delete cascade,
  competition_id      uuid not null references public.competitions(id),
  home_team_id        uuid not null references public.teams(id),
  away_team_id        uuid not null references public.teams(id),
  kickoff_at          timestamptz not null,
  status              public.fixture_status not null default 'scheduled',
  home_score          integer,
  away_score          integer,
  -- Derived, never written by hand.
  result public.outcome generated always as (
    case
      when home_score is null or away_score is null then null
      when home_score > away_score then 'HOME'::public.outcome
      when home_score < away_score then 'AWAY'::public.outcome
      else 'DRAW'::public.outcome
    end
  ) stored,
  updated_at          timestamptz not null default now(),
  constraint fixture_teams_differ check (home_team_id <> away_team_id)
);

create index fixtures_gameweek_idx on public.fixtures (gameweek_id);
create index fixtures_kickoff_idx  on public.fixtures (kickoff_at);


-- ------------------------------------------------------------
--  Leagues and divisions
--
--  League   = the social unit (one join code, one overall table)
--  Division = a tier within it; drafting happens inside a division
-- ------------------------------------------------------------
create table public.leagues (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  join_code     text not null unique,
  owner_id      uuid not null references auth.users(id) on delete cascade,
  season_id     uuid not null references public.seasons(id) on delete cascade,
  division_size integer not null default 3
                  constraint division_size_sane check (division_size between 2 and 10),
  created_at    timestamptz not null default now()
);

create table public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table public.divisions (
  id         uuid primary key default uuid_generate_v4(),
  league_id  uuid not null references public.leagues(id) on delete cascade,
  name       text not null,               -- 'Division 1'
  tier       integer not null,            -- 1 = top
  created_at timestamptz not null default now(),
  unique (league_id, tier)
);

create table public.division_members (
  division_id uuid not null references public.divisions(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  league_id   uuid not null references public.leagues(id) on delete cascade,
  primary key (division_id, user_id),
  -- A player sits in exactly one division per league.
  unique (league_id, user_id)
);


-- ------------------------------------------------------------
--  Drafts — one per division per gameweek
-- ------------------------------------------------------------
create table public.drafts (
  id                uuid primary key default uuid_generate_v4(),
  division_id       uuid not null references public.divisions(id) on delete cascade,
  gameweek_id       uuid not null references public.gameweeks(id) on delete cascade,
  status            public.draft_status not null default 'pending',
  -- Turn order for this gameweek. Snake order is derived from this array;
  -- the starting player rotates each gameweek so nobody holds first pick twice
  -- running. Stored explicitly so the order is auditable after the fact.
  pick_order        uuid[] not null,
  picks_per_player  integer not null default 3,
  current_turn      integer not null default 0,   -- 0-based turn index
  turn_started_at   timestamptz,
  turn_expires_at   timestamptz,
  completed_at      timestamptz,
  unique (division_id, gameweek_id)
);

create index drafts_expiry_idx on public.drafts (turn_expires_at)
  where status = 'active';


-- ------------------------------------------------------------
--  Picks
-- ------------------------------------------------------------
create table public.picks (
  id                uuid primary key default uuid_generate_v4(),
  draft_id          uuid not null references public.drafts(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  fixture_id        uuid not null references public.fixtures(id) on delete cascade,
  predicted_outcome public.outcome not null,
  pick_number       integer not null,             -- turn index this pick filled
  is_auto_pick      boolean not null default false,
  points_awarded    integer,                      -- null until settled
  created_at        timestamptz not null default now(),

  -- THE exclusivity rule. Two players hitting "pick" on the same fixture in the
  -- same second is the normal case near a deadline, not an edge case; only the
  -- database can arbitrate it.
  unique (draft_id, fixture_id),

  -- One pick per turn.
  unique (draft_id, pick_number)
);

create index picks_user_idx    on public.picks (user_id);
create index picks_fixture_idx on public.picks (fixture_id);


-- ------------------------------------------------------------
--  Settled scores, per player per gameweek
-- ------------------------------------------------------------
create table public.gameweek_scores (
  user_id       uuid not null references auth.users(id) on delete cascade,
  gameweek_id   uuid not null references public.gameweeks(id) on delete cascade,
  division_id   uuid not null references public.divisions(id) on delete cascade,
  points        integer not null default 0,
  correct_count integer not null default 0,
  settled_at    timestamptz not null default now(),
  primary key (user_id, gameweek_id)
);

create index gameweek_scores_division_idx on public.gameweek_scores (division_id);
