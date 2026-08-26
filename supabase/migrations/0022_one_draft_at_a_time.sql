-- ============================================================
--  0022 — a division drafts one gameweek at a time
--
--  GW5 and GW6 were both open, and the same division was on the clock in
--  both: one player owed picks in two rounds at once, was emailed about
--  both a second apart, and could only ever see one of them. The pages
--  pick a single round to show — currentDraftFor takes the lowest-numbered
--  active draft — so the second sat invisible until its turn expired and
--  auto-pick filled it in. Nothing about that is recoverable by the player.
--
--  Overlapping windows are not the bug. They're deliberate: 0014 pulls the
--  next gameweek's window forward when one settles, so a league whose
--  results are all in by Sunday doesn't sit idle until Tuesday. The bug is
--  that start_drafts_for_gameweek hands a draft to *every* division that
--  lacks one, without asking whether that division has finished the round
--  before it.
--
--  The admin path already gets this right — open_next_gameweek_for_league
--  in 0017 refuses while any division in the group is still picking. The
--  automatic path never had the equivalent check, and the automatic path is
--  the one that runs every ten minutes.
--
--  So: a division still holding an unfinished draft in an earlier gameweek
--  is skipped. It isn't blocked, only queued — open_due_drafts runs on the
--  same cron, so the moment that draft completes the next round is created
--  on the following pass. Divisions that have finished are unaffected and
--  still get the early start.
-- ============================================================

create or replace function public.start_drafts_for_gameweek(p_gameweek_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_gw      public.gameweeks%rowtype;
  v_div     record;
  v_order   uuid[];
  v_n       integer;
  v_shift   integer;
  v_created integer := 0;
begin
  select * into v_gw from public.gameweeks where id = p_gameweek_id;
  if not found then raise exception 'Gameweek not found'; end if;

  for v_div in
    select d.id from public.divisions d
     -- Divisions are per-season. Without this a gameweek in the new season
     -- opens drafts for last season's divisions too.
     where d.season_id = v_gw.season_id
       and not exists (
         select 1 from public.drafts dr
          where dr.division_id = d.id and dr.gameweek_id = p_gameweek_id
       )
       -- The round before has to be finished first.
       and not exists (
         select 1
           from public.drafts dr
           join public.gameweeks g on g.id = dr.gameweek_id
          where dr.division_id = d.id
            and dr.status <> 'complete'
            and g.season_id   = v_gw.season_id
            and g.number      < v_gw.number
       )
  loop
    -- seat is the owner's running order; user_id only breaks ties.
    select array_agg(dm.user_id order by dm.seat, dm.user_id)
      into v_order
      from public.division_members dm
     where dm.division_id = v_div.id;

    v_n := coalesce(array_length(v_order, 1), 0);
    continue when v_n = 0;

    v_shift := (v_gw.number - 1) % v_n;
    if v_shift > 0 then
      v_order := v_order[v_shift + 1 : v_n] || v_order[1 : v_shift];
    end if;

    insert into public.drafts
      (division_id, gameweek_id, status, pick_order, current_turn,
       turn_started_at, turn_expires_at)
    values
      (v_div.id, p_gameweek_id, 'active', v_order, 0,
       now(),
       public.turn_deadline(p_gameweek_id, v_n))
    on conflict (division_id, gameweek_id) do nothing;

    if found then v_created := v_created + 1; end if;
  end loop;

  if v_created > 0 then
    update public.gameweeks set status = 'drafting'
     where id = p_gameweek_id and status = 'upcoming';
  end if;

  return v_created;
end;
$$;

revoke all on function public.start_drafts_for_gameweek(uuid)
  from public, anon, authenticated;


-- ------------------------------------------------------------
--  Clear the drafts this already created
-- ------------------------------------------------------------
--
--  Deliberately narrow. Only a draft that is unfinished, has no picks in it
--  at all, and belongs to a division with an unfinished draft in an earlier
--  gameweek — which is precisely the state the missing check produced, and
--  nothing a player has put work into. Anything with a single pick is left
--  alone to be looked at by hand.
--
--  These come back on their own: open_due_drafts recreates them once the
--  earlier round is done.
delete from public.drafts victim
 where victim.status <> 'complete'
   and not exists (
     select 1 from public.picks p where p.draft_id = victim.id
   )
   and exists (
     select 1
       from public.drafts earlier
       join public.gameweeks eg on eg.id = earlier.gameweek_id
      where earlier.division_id = victim.division_id
        and earlier.status <> 'complete'
        and earlier.id     <> victim.id
        and eg.season_id = (
          select season_id from public.gameweeks where id = victim.gameweek_id
        )
        and eg.number < (
          select number from public.gameweeks where id = victim.gameweek_id
        )
   );


-- A gameweek left with no drafts at all shouldn't still claim to be
-- drafting; it goes back to upcoming and is opened again in the usual way.
update public.gameweeks g
   set status = 'upcoming'
 where g.status = 'drafting'
   and not exists (
     select 1 from public.drafts d where d.gameweek_id = g.id
   );
