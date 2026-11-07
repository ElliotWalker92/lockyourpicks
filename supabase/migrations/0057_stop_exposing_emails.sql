-- ============================================================
--  Every player's email address was world-readable
--
--  `profiles: public read` is `using (true)`, and PostgREST serves the
--  profiles table to the `anon` role. The anon key is not a secret --
--  it is compiled into the page source of every Next.js build, because
--  that is what it is for. So anyone could ask the API for
--  profiles?select=display_name,email and be handed all sixteen.
--
--  Confirmed against production on 7 November 2026: sixteen rows,
--  sixteen addresses. It also contradicts the privacy policy published
--  the same day, which says an email address is never shown to other
--  players.
--
--  RLS is row-level, so no policy can hide one column of a row the
--  reader is otherwise allowed to see. The fix is the older mechanism
--  underneath it: take the table away from the roles PostgREST hands
--  requests to, then hand back every column except this one.
--
--  Nothing in the app reads this column as anon or authenticated. The
--  notification paths get an address either from a `security definer`
--  function -- which runs as its owner, so column grants on the caller
--  do not apply -- or from the service-role client in cron, which
--  bypasses both. `profiles: own update` is untouched, so a player can
--  still change their own address through the app.
--
--  Row-level tightening of this table, and of leagues and
--  league_members, is a separate migration: it risks breaking reads the
--  app depends on, and wants testing first. This one is urgent and
--  cannot break anything.
-- ============================================================

-- The TABLE-level grant has to go first. In Postgres a table-level
-- SELECT lets its holder read every column, and a column-level revoke
-- does not cut a hole in it: column grants only decide anything once
-- there is no table grant underneath. Supabase grants table-level
-- select on everything in `public` to anon and authenticated, so
-- revoking just the column is a no-op -- tested on a local stack, where
-- the address was still served until these two lines were added.
revoke select on public.profiles from anon;
revoke select on public.profiles from authenticated;

revoke select (email) on public.profiles from anon;
revoke select (email) on public.profiles from authenticated;

-- Belt and braces: `grant select on <table>` anywhere later would restore
-- every column, so name the ones these roles are meant to have instead of
-- relying on the revoke surviving.
-- Every column except email, taken from the generated types rather than
-- from memory: an omission here is not a security hole but a broken
-- page, and the profile screen reads the three notify/tour columns that
-- a plausible-looking shorter list leaves out.
grant select (
  id, display_name, avatar_color, avatar_url, is_admin,
  notify_turn, notify_round_complete, tour_seen_at,
  created_at, updated_at
) on public.profiles to anon, authenticated;

comment on column public.profiles.email is
  'Mirror of auth.users.email, kept in step by on_auth_user_email_changed. '
  'Deliberately NOT granted to anon or authenticated: it is read only by '
  'security-definer functions and the service role. See migration 0057.';
