-- ============================================================
--  0019 — let the service role run an import
--
--  The import is owner-only so that one group's owner can't write picks
--  into another's. That check reads auth.uid(), which is null for a
--  server-side call with the service key — so the one path actually being
--  used to load a season in from a spreadsheet was the one path refused.
--
--  The alternative was signing in as the group's owner to run it, which
--  means holding a real person's password. Recognising the service role
--  costs nothing in safety: that key already bypasses row-level security
--  entirely and could insert the same rows by hand. What it buys is that
--  the rows go in through the same function, with the same checks on
--  division membership, fixture eligibility and exclusivity, instead of a
--  second hand-written path that drifts.
-- ============================================================

create or replace function public.import_gameweek_picks(
  p_league_id   uuid,
  p_gameweek_id uuid,
  p_entries     jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_service  boolean := coalesce(
    current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role',
    false
  );
  v_league   public.leagues%rowtype;
  v_season   uuid;
  v_gw       public.gameweeks%rowtype;
  v_entry    jsonb;
  v_user     uuid;
  v_fixture  uuid;
  v_outcome  public.outcome;
  v_division uuid;
  v_draft    uuid;
  v_next     integer;
  v_written  integer := 0;
  v_rejected jsonb := '[]'::jsonb;
begin
  if v_uid is null and not v_service then
    raise exception 'You need to be signed in.';
  end if;

  select * into v_league from public.leagues where id = p_league_id;
  if not found then raise exception 'Group not found.'; end if;

  if not (v_service or v_league.owner_id = v_uid or public.is_admin()) then
    raise exception 'Only the group owner can import picks.';
  end if;

  select id into v_season from public.seasons where is_active;
  if v_season is null then raise exception 'No active season.'; end if;

  select * into v_gw from public.gameweeks where id = p_gameweek_id;
  if not found then raise exception 'Gameweek not found.'; end if;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    v_user    := (v_entry->>'user_id')::uuid;
    v_fixture := (v_entry->>'fixture_id')::uuid;
    v_outcome := (v_entry->>'outcome')::public.outcome;

    select dm.division_id into v_division
      from public.division_members dm
     where dm.user_id = v_user
       and dm.league_id = p_league_id
       and dm.season_id = v_season;

    if v_division is null then
      v_rejected := v_rejected || jsonb_build_object(
        'user_id', v_user, 'reason', 'not in a division in this group');
      continue;
    end if;

    if not exists (
      select 1 from public.fixtures
       where id = v_fixture and gameweek_id = p_gameweek_id
    ) then
      v_rejected := v_rejected || jsonb_build_object(
        'fixture_id', v_fixture, 'reason', 'not in this gameweek');
      continue;
    end if;

    select id into v_draft
      from public.drafts
     where division_id = v_division and gameweek_id = p_gameweek_id;

    if v_draft is null then
      insert into public.drafts
        (division_id, gameweek_id, status, pick_order, current_turn,
         completed_at)
      select v_division, p_gameweek_id, 'complete',
             coalesce(
               (select array_agg(dm.user_id order by dm.seat, dm.user_id)
                  from public.division_members dm
                 where dm.division_id = v_division),
               array[]::uuid[]),
             0, now()
      returning id into v_draft;
    end if;

    select coalesce(max(pick_number), -1) + 1 into v_next
      from public.picks where draft_id = v_draft;

    begin
      insert into public.picks
        (draft_id, user_id, fixture_id, predicted_outcome, pick_number,
         is_auto_pick, source)
      values
        (v_draft, v_user, v_fixture, v_outcome, v_next, false, 'import');
      v_written := v_written + 1;
    exception when unique_violation then
      v_rejected := v_rejected || jsonb_build_object(
        'fixture_id', v_fixture,
        'user_id', v_user,
        'reason', 'already taken in that division');
    end;
  end loop;

  perform public.settle_gameweek(p_gameweek_id);

  return jsonb_build_object(
    'gameweek', v_gw.number,
    'written', v_written,
    'rejected', v_rejected
  );
end;
$$;

revoke all on function public.import_gameweek_picks(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.import_gameweek_picks(uuid, uuid, jsonb)
  to authenticated, service_role;
