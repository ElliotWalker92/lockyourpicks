-- ============================================================
--  Take delete_own_account() away from anon
--
--  0054 revoked it from PUBLIC and granted it to `authenticated`,
--  which is not the whole story: Supabase sets default privileges that
--  grant execute on new functions in `public` to `anon` as well, so a
--  signed-out caller could still invoke it. Probing the live function
--  with the anon key returned the function's own refusal rather than a
--  permission error, which is how this came to light.
--
--  Nothing could come of it -- `anon` has no auth.uid(), so the first
--  line of the function raises and the transaction rolls back -- but a
--  deletion routine should not be reachable by someone with no account
--  to delete. The guard inside stays regardless: this is the second
--  lock, not a replacement for the first.
-- ============================================================

revoke execute on function public.delete_own_account() from anon;
