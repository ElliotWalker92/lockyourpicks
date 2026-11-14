-- ============================================================
--  Rescoring corrects a total; it must never invent one
--
--  0063 added `rescore_stale_gameweeks` to chase the one thing a stored
--  total cannot do for itself: a pick scored weeks later, on a rearranged
--  date, in a gameweek that had already settled. It found the stale rows
--  correctly and then fixed them with `write_gameweek_scores`, which is an
--  upsert — and an upsert inserts.
--
--  Run against the real data it rewrote nine gameweeks instead of one.
--  Every player whose early history sits under a division their current draft
--  no longer belongs to looked stale, because there was no live aggregate
--  for that (player, gameweek, division) at all. The upsert then wrote a
--  *second* row under the division the draft does belong to and left the
--  original in place, so a season total that read 37 read 53. It also
--  wrote rows for a gameweek still being drafted, stamping settled_at on a
--  round nobody has played.
--
--  Both faults are the same mistake: a sweep whose job is to correct a
--  number was given a tool that can also create one. So it is an UPDATE
--  now, matched on the row that already exists. A total with no live picks
--  behind it is left exactly as it is — that is somebody's history under a
--  division they have since left, not a number to be recomputed — and a
--  gameweek with no rows yet gets none, because writing those is
--  settlement's job and settlement knows when the round is over.
-- ============================================================

create or replace function public.rescore_stale_gameweeks()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_fixed integer;
begin
  with live as (
    select d.gameweek_id,
           p.user_id,
           d.division_id,
           coalesce(sum(p.points_awarded), 0)::integer as points
      from public.picks p
      join public.drafts d on d.id = p.draft_id
     group by d.gameweek_id, p.user_id, d.division_id
  )
  update public.gameweek_scores s
     set points        = live.points,
         correct_count = live.points,
         settled_at    = now()
    from live
   where live.gameweek_id = s.gameweek_id
     and live.user_id     = s.user_id
     and live.division_id = s.division_id
     and live.points is distinct from s.points;

  get diagnostics v_fixed = row_count;
  return v_fixed;
end;
$$;

revoke all on function public.rescore_stale_gameweeks() from public, anon, authenticated;
grant execute on function public.rescore_stale_gameweeks() to service_role;

comment on function public.rescore_stale_gameweeks() is
  'Rewrites a stored gameweek total that no longer matches the picks '
  'behind it — which happens when a postponed match is replayed in a '
  'later gameweek and scores a pick drafted in an earlier, already '
  'settled one. Updates only: it never inserts a row, because a total '
  'with no live picks behind it is history under a division the player '
  'has left, and creating rows for a round still being drafted is '
  'settlement''s job. Returns the number of rows corrected.';
