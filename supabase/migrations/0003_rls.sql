-- ============================================================
--  Lock Your Picks v2 — row level security
--
--  Shape of it: reference data is world-readable, league data is
--  readable by members, and *nothing* game-critical is directly
--  writable by players. Picks in particular have no INSERT policy at
--  all — the only way in is make_pick(), which is SECURITY DEFINER.
-- ============================================================

alter table public.profiles         enable row level security;
alter table public.seasons          enable row level security;
alter table public.competitions     enable row level security;
alter table public.teams            enable row level security;
alter table public.gameweeks        enable row level security;
alter table public.fixtures         enable row level security;
alter table public.leagues          enable row level security;
alter table public.league_members   enable row level security;
alter table public.divisions        enable row level security;
alter table public.division_members enable row level security;
alter table public.drafts           enable row level security;
alter table public.picks            enable row level security;
alter table public.gameweek_scores  enable row level security;


-- ------------------------------------------------------------
--  Helpers
--
--  SECURITY DEFINER so they can read membership tables without
--  re-triggering the policies that call them (which would recurse).
-- ------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and is_admin
  );
$$;

create or replace function public.shares_league_with_division(p_division_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.divisions d
      join public.league_members lm on lm.league_id = d.league_id
     where d.id = p_division_id
       and lm.user_id = auth.uid()
  );
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.shares_league_with_division(uuid) to authenticated;


-- ------------------------------------------------------------
--  Reference data — readable by everyone, written by admins only
-- ------------------------------------------------------------
create policy "reference: read seasons"      on public.seasons      for select using (true);
create policy "reference: read competitions" on public.competitions for select using (true);
create policy "reference: read teams"        on public.teams        for select using (true);
create policy "reference: read gameweeks"    on public.gameweeks    for select using (true);
create policy "reference: read fixtures"     on public.fixtures     for select using (true);

create policy "reference: admin writes seasons"      on public.seasons      for all using (public.is_admin()) with check (public.is_admin());
create policy "reference: admin writes competitions" on public.competitions for all using (public.is_admin()) with check (public.is_admin());
create policy "reference: admin writes teams"        on public.teams        for all using (public.is_admin()) with check (public.is_admin());
create policy "reference: admin writes gameweeks"    on public.gameweeks    for all using (public.is_admin()) with check (public.is_admin());
create policy "reference: admin writes fixtures"     on public.fixtures     for all using (public.is_admin()) with check (public.is_admin());


-- ------------------------------------------------------------
--  profiles
-- ------------------------------------------------------------
create policy "profiles: public read"
  on public.profiles for select using (true);

create policy "profiles: own update"
  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "profiles: own insert"
  on public.profiles for insert with check (auth.uid() = id);


-- ------------------------------------------------------------
--  Leagues
--
--  Readable by anyone so a join code can be validated before joining.
-- ------------------------------------------------------------
create policy "leagues: read"
  on public.leagues for select using (true);

create policy "leagues: owner creates"
  on public.leagues for insert with check (auth.uid() = owner_id);

create policy "leagues: owner or admin updates"
  on public.leagues for update
  using (auth.uid() = owner_id or public.is_admin())
  with check (auth.uid() = owner_id or public.is_admin());

create policy "leagues: owner or admin deletes"
  on public.leagues for delete
  using (auth.uid() = owner_id or public.is_admin());


-- ------------------------------------------------------------
--  Membership
-- ------------------------------------------------------------
create policy "league_members: read"
  on public.league_members for select using (true);

create policy "league_members: join self"
  on public.league_members for insert with check (auth.uid() = user_id);

create policy "league_members: leave self"
  on public.league_members for delete
  using (
    auth.uid() = user_id
    or public.is_admin()
    or exists (select 1 from public.leagues l
                where l.id = league_id and l.owner_id = auth.uid())
  );

create policy "divisions: read" on public.divisions for select using (true);

-- Divisions are assigned by the league owner, never self-selected: a player
-- picking their own tier would defeat promotion and relegation.
create policy "divisions: owner or admin writes"
  on public.divisions for all
  using (
    public.is_admin()
    or exists (select 1 from public.leagues l
                where l.id = league_id and l.owner_id = auth.uid())
  )
  with check (
    public.is_admin()
    or exists (select 1 from public.leagues l
                where l.id = league_id and l.owner_id = auth.uid())
  );

create policy "division_members: read" on public.division_members for select using (true);

create policy "division_members: owner or admin writes"
  on public.division_members for all
  using (
    public.is_admin()
    or exists (select 1 from public.leagues l
                where l.id = league_id and l.owner_id = auth.uid())
  )
  with check (
    public.is_admin()
    or exists (select 1 from public.leagues l
                where l.id = league_id and l.owner_id = auth.uid())
  );


-- ------------------------------------------------------------
--  Drafts — readable by leaguemates, writable by nobody
--
--  Turn state is advanced only through make_pick()/auto_pick().
-- ------------------------------------------------------------
create policy "drafts: leaguemates read"
  on public.drafts for select
  using (public.shares_league_with_division(division_id) or public.is_admin());


-- ------------------------------------------------------------
--  Picks
--
--  Deliberately no INSERT, UPDATE or DELETE policy. make_pick() is
--  SECURITY DEFINER and bypasses RLS, so it is the sole write path —
--  which is the point: a pick that skipped the turn-order and deadline
--  checks would be exactly the cheat this game invites.
--
--  Reads are open to leaguemates. Fixture exclusivity means a rival's
--  claim is information you need in order to draft at all, so picks are
--  visible as they happen rather than hidden until deadline.
-- ------------------------------------------------------------
create policy "picks: leaguemates read"
  on public.picks for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.drafts d
       where d.id = draft_id
         and public.shares_league_with_division(d.division_id)
    )
  );


-- ------------------------------------------------------------
--  Scores — public, for leaderboards
-- ------------------------------------------------------------
create policy "gameweek_scores: read"
  on public.gameweek_scores for select using (true);


-- ------------------------------------------------------------
--  Grants
--
--  No table-level INSERT/UPDATE/DELETE on picks or drafts for anyone.
-- ------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on
  public.profiles, public.seasons, public.competitions, public.teams,
  public.gameweeks, public.fixtures, public.leagues, public.league_members,
  public.divisions, public.division_members, public.drafts, public.picks,
  public.gameweek_scores
to anon, authenticated;

grant insert, update on public.profiles              to authenticated;
grant insert, update, delete on public.leagues       to authenticated;
grant insert, delete on public.league_members        to authenticated;
grant insert, update, delete on public.divisions        to authenticated;
grant insert, update, delete on public.division_members to authenticated;
