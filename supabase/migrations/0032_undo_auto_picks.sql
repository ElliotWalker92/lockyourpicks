-- ============================================================
--  0032 — let an owner undo the clock's picks
--
--  Gameweek 15 auto-picked five of nine players because the schedule was
--  unhittable. Putting that right took a hand-written script against the
--  live database: delete the auto-picks, rewind each division to the first
--  seat that lost its turn, restart the clock, unstamp the notification so
--  the people affected get told again.
--
--  That is a thing an owner should be able to do at two in the afternoon
--  without me. The auto-pick exists so one quiet player can't stop a
--  division; it isn't a judgement that they didn't want a turn.
--
--  What it deliberately does not do:
--
--   - touch a pick somebody actually made. Only is_auto_pick rows go, and
--     the rewind stops at the earliest seat that was auto-picked, so a
--     player who picked properly before the clock caught somebody else
--     keeps both their picks and their place.
--   - work once the football has started. After the first kickoff a
--     rewound player cannot retake the fixtures that have gone, so an undo
--     would hand them a worse board than the clock did.
-- ============================================================


-- ------------------------------------------------------------
--  What there is to undo
-- ------------------------------------------------------------
--
--  Read by the button, so it can say what it will do before it does it
--  and stay hidden when there is nothing to undo.
create or replace function public.auto_pick_summary(p_league_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_season  uuid;
  v_gw      public.gameweeks%rowtype;
  v_result  jsonb;
begin
  select id into v_season from public.seasons where is_active;
  if v_season is null then
    return jsonb_build_object('gameweek', null, 'picks', 0, 'players', '[]'::jsonb);
  end if;

  -- The round this group is drafting that hasn't kicked off yet.
  select g.* into v_gw
    from public.gameweeks g
    join public.drafts d  on d.gameweek_id = g.id
    join public.divisions dv on dv.id = d.division_id
   where dv.league_id = p_league_id
     and dv.season_id = v_season
     and g.draft_closes_at > now()
   order by g.number desc
   limit 1;

  if not found then
    return jsonb_build_object('gameweek', null, 'picks', 0, 'players', '[]'::jsonb);
  end if;

  select jsonb_build_object(
           'gameweek', v_gw.number,
           'closes_at', v_gw.draft_closes_at,
           'picks', coalesce(count(pk.id), 0),
           'players', coalesce(
             jsonb_agg(distinct coalesce(pr.display_name, 'A player'))
               filter (where pk.id is not null),
             '[]'::jsonb)
         )
    into v_result
    from public.drafts d
    join public.divisions dv on dv.id = d.division_id
    left join public.picks pk
      on pk.draft_id = d.id and pk.is_auto_pick
    left join public.profiles pr on pr.id = pk.user_id
   where dv.league_id = p_league_id
     and dv.season_id = v_season
     and d.gameweek_id = v_gw.id;

  return v_result;
end;
$$;

revoke all on function public.auto_pick_summary(uuid) from public, anon;
grant execute on function public.auto_pick_summary(uuid) to authenticated;


-- ------------------------------------------------------------
--  Undo them
-- ------------------------------------------------------------
create or replace function public.rollback_auto_picks(p_league_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_league   public.leagues%rowtype;
  v_season   uuid;
  v_gw       public.gameweeks%rowtype;
  v_draft    record;
  v_seat     integer;
  v_removed  integer;
  v_total    integer := 0;
  v_divs     integer := 0;
begin
  if v_uid is null then
    raise exception 'You need to be signed in.';
  end if;

  select * into v_league from public.leagues where id = p_league_id;
  if not found then
    raise exception 'Group not found.';
  end if;

  if not (v_league.owner_id = v_uid or public.is_admin()) then
    raise exception 'Only the group owner can undo the clock''s picks.';
  end if;

  select id into v_season from public.seasons where is_active;

  select g.* into v_gw
    from public.gameweeks g
    join public.drafts d  on d.gameweek_id = g.id
    join public.divisions dv on dv.id = d.division_id
   where dv.league_id = p_league_id
     and dv.season_id = v_season
     and g.draft_closes_at > now()
   order by g.number desc
   limit 1;

  if not found then
    raise exception
      'Nothing to undo: this group has no round still open for picks.';
  end if;

  if public.draft_hard_deadline(v_gw.id) <= now() then
    raise exception
      'Gameweek % is past its deadline — a rewound player could not retake the fixtures that have gone.',
      v_gw.number;
  end if;

  for v_draft in
    select d.id, d.pick_order, d.gameweek_id
      from public.drafts d
      join public.divisions dv on dv.id = d.division_id
     where dv.league_id = p_league_id
       and dv.season_id = v_season
       and d.gameweek_id = v_gw.id
  loop
    -- The earliest seat the clock picked for. Anything before it was a
    -- real turn and is left exactly as it is.
    select min(array_position(v_draft.pick_order, pk.user_id) - 1)
      into v_seat
      from public.picks pk
     where pk.draft_id = v_draft.id
       and pk.is_auto_pick;

    continue when v_seat is null;

    delete from public.picks
     where draft_id = v_draft.id and is_auto_pick;
    get diagnostics v_removed = row_count;

    update public.drafts
       set status          = 'active',
           completed_at    = null,
           current_turn    = v_seat,
           turn_started_at = now(),
           turn_expires_at = public.turn_deadline(
                               v_draft.gameweek_id,
                               coalesce(array_length(v_draft.pick_order, 1), 1) - v_seat
                             ),
           -- Unstamped so the job tells them again. Being handed your turn
           -- back silently is the same as not having it back.
           turn_notified_at = null
     where id = v_draft.id;

    v_total := v_total + v_removed;
    v_divs  := v_divs + 1;
  end loop;

  if v_total = 0 then
    return jsonb_build_object(
      'undone', 0, 'divisions', 0, 'gameweek', v_gw.number,
      'message', format('Nothing to undo in gameweek %s.', v_gw.number)
    );
  end if;

  return jsonb_build_object(
    'undone', v_total,
    'divisions', v_divs,
    'gameweek', v_gw.number,
    'message', format(
      '%s auto-pick(s) undone across %s division(s). Gameweek %s is back with the players who missed it.',
      v_total, v_divs, v_gw.number)
  );
end;
$$;

revoke all on function public.rollback_auto_picks(uuid) from public, anon;
grant execute on function public.rollback_auto_picks(uuid) to authenticated;
