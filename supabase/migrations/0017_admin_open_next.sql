-- ============================================================
--  0017 — a group owner can start the next round early
--
--  Drafting normally opens when the previous gameweek settles, which
--  waits on the football finishing. A group that has everyone's picks in
--  by Friday teatime then sits idle until Monday's last game is played,
--  even though there is nothing left for anyone to do.
--
--  This lets the owner start the next round as soon as their own group
--  has finished picking — and only then. The guard is the point: opening
--  early while somebody still owes picks would put two drafts in front of
--  them at once and quietly hand the slower player two deadlines.
--
--  Scoped to one group. start_drafts_for_gameweek loops every division in
--  the database, which is right for the cron and quite wrong for a button
--  pressed by the owner of one group among many.
-- ============================================================

create or replace function public.open_next_gameweek_for_league(
  p_league_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_league    public.leagues%rowtype;
  v_season    uuid;
  v_current   public.gameweeks%rowtype;
  v_next      public.gameweeks%rowtype;
  v_pending   integer;
  v_div       record;
  v_order     uuid[];
  v_n         integer;
  v_shift     integer;
  v_created   integer := 0;
begin
  if v_uid is null then
    raise exception 'You need to be signed in.';
  end if;

  select * into v_league from public.leagues where id = p_league_id;
  if not found then
    raise exception 'Group not found.';
  end if;

  -- The open league has no owner by design, so only an app admin can
  -- hurry it along.
  if not (v_league.owner_id = v_uid or public.is_admin()) then
    raise exception 'Only the group owner can start the next round.';
  end if;

  select id into v_season from public.seasons where is_active;
  if v_season is null then
    raise exception 'No active season.';
  end if;

  -- The latest gameweek this group has actually drafted.
  select g.* into v_current
    from public.gameweeks g
    join public.drafts d on d.gameweek_id = g.id
    join public.divisions dv on dv.id = d.division_id
   where dv.league_id = p_league_id
     and dv.season_id = v_season
   order by g.number desc
   limit 1;

  if not found then
    raise exception 'This group has not drafted a gameweek yet.';
  end if;

  -- Every draft in this group for that gameweek must be finished.
  select count(*) into v_pending
    from public.drafts d
    join public.divisions dv on dv.id = d.division_id
   where dv.league_id = p_league_id
     and dv.season_id = v_season
     and d.gameweek_id = v_current.id
     and d.status <> 'complete';

  if v_pending > 0 then
    raise exception
      'Still waiting on % division(s) to finish gameweek %.',
      v_pending, v_current.number;
  end if;

  select * into v_next
    from public.gameweeks
   where season_id = v_current.season_id
     and number > v_current.number
   order by number
   limit 1;

  if not found then
    raise exception 'There is no next gameweek to open.';
  end if;

  if v_next.draft_closes_at <= now() then
    raise exception
      'Gameweek % has already kicked off.', v_next.number;
  end if;

  -- Already going: nothing to do, and say so rather than pretending.
  if exists (
    select 1 from public.drafts d
      join public.divisions dv on dv.id = d.division_id
     where dv.league_id = p_league_id
       and dv.season_id = v_season
       and d.gameweek_id = v_next.id
  ) then
    return jsonb_build_object(
      'opened', false,
      'gameweek', v_next.number,
      'message', format('Gameweek %s is already open.', v_next.number)
    );
  end if;

  -- Pull the window forward, never push it back.
  if v_next.draft_opens_at > now() then
    update public.gameweeks
       set draft_opens_at = now()
     where id = v_next.id;
  end if;

  for v_div in
    select d.id from public.divisions d
     where d.league_id = p_league_id
       and d.season_id = v_season
  loop
    select array_agg(dm.user_id order by dm.seat, dm.user_id)
      into v_order
      from public.division_members dm
     where dm.division_id = v_div.id;

    v_n := coalesce(array_length(v_order, 1), 0);
    continue when v_n = 0;

    v_shift := (v_next.number - 1) % v_n;
    if v_shift > 0 then
      v_order := v_order[v_shift + 1 : v_n] || v_order[1 : v_shift];
    end if;

    insert into public.drafts
      (division_id, gameweek_id, status, pick_order, current_turn,
       turn_started_at, turn_expires_at)
    values
      (v_div.id, v_next.id, 'active', v_order, 0,
       now(),
       public.turn_deadline(v_next.id, v_n))
    on conflict (division_id, gameweek_id) do nothing;

    if found then v_created := v_created + 1; end if;
  end loop;

  update public.gameweeks set status = 'drafting'
   where id = v_next.id and status = 'upcoming';

  return jsonb_build_object(
    'opened', v_created > 0,
    'gameweek', v_next.number,
    'drafts', v_created,
    'message', format('Gameweek %s is open — %s division(s) drafting.',
                      v_next.number, v_created)
  );
end;
$$;

revoke all on function public.open_next_gameweek_for_league(uuid)
  from public, anon;
grant execute on function public.open_next_gameweek_for_league(uuid)
  to authenticated;
