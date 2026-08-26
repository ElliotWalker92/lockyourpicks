-- ============================================================
--  0021 — actually publish the tables the app subscribes to
--
--  The draft board has subscribed to `picks` and `drafts` since it was
--  written, so a rival's claim was supposed to land on your screen the
--  moment they made it. It never did. Nothing was wrong with the client:
--  the `supabase_realtime` publication is empty, so Postgres was never
--  sending the changes. A subscription to a table that isn't published
--  reports SUBSCRIBED and then stays silent forever, which is why this
--  went unnoticed — there is no error to see.
--
--  Verified from the outside before writing this: a broadcast on the same
--  socket round-trips, while an UPDATE on any table in `public` produces
--  no event at all.
--
--  Four tables, and only four. Realtime traffic is per-subscriber work, so
--  this is the set the interface actually reads, not everything that moves:
--    picks, drafts        — the board, live as a division drafts
--    fixtures             — scores arriving during a gameweek
--    gameweek_scores      — the points those scores settle into
-- ============================================================

do $$
declare
  v_table text;
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  foreach v_table in array array['picks', 'drafts', 'fixtures', 'gameweek_scores']
  loop
    -- Re-runnable: adding a table already in the publication is an error,
    -- not a no-op.
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = v_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;


-- ------------------------------------------------------------
--  Deletes have to carry enough to be filtered
-- ------------------------------------------------------------
--
--  A subscriber filters on a column — the board watches
--  `draft_id=eq.<id>`. Under the default replica identity a DELETE sends
--  only the primary key, so `draft_id` is absent, the filter can't match,
--  and the event is dropped. Removing a pick would then be the one action
--  that didn't reach the other players' screens.
--
--  FULL makes the deleted row available in its entirety. It costs more WAL
--  per write, which is why it's set on picks alone: it's small, and it's
--  the only one of the four we delete from in normal use.
alter table public.picks replica identity full;
