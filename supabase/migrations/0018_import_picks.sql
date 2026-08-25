-- ============================================================
--  0018 — entering picks for a gameweek that has already been played
--
--  make_pick refuses a fixture that has kicked off, which is exactly
--  right for drafting and exactly wrong for a group moving across from a
--  spreadsheet with half a season already behind them. There was no way
--  to record what somebody picked in September once September had
--  happened.
--
--  This is that way, and it is deliberately a different door: owner or
--  admin only, and every row it writes is marked `import` so it can be
--  told apart from a pick somebody actually made on the clock — and
--  removed again in one statement if the import was wrong.
-- ============================================================

alter table public.picks
  add column if not exists source text not null default 'live';

alter table public.picks
  drop constraint if exists picks_source_valid;
alter table public.picks
  add constraint picks_source_valid check (source in ('live', 'import'));

comment on column public.picks.source is
  'live = drafted or auto-picked in the app; import = entered afterwards by a group owner.';


/**
 * Record a whole gameweek's picks for one group, after the fact.
 *
 * Entries are [{ "user_id": uuid, "fixture_id": uuid, "outcome": "HOME" }].
 * Each player's division is looked up rather than passed, so a caller
 * can hand over the group's entire gameweek in one call.
 *
 * Drafts are created as complete where they don't exist: a historic
 * gameweek was never drafted in the app, but the picks still have to hang
 * off something, and leaving them active would put a dead turn in front
 * of somebody.
 *
 * Exclusivity still applies. Two players in the same division given the
 * same fixture is a mistake in the spreadsheet, so the second is rejected
 * and reported rather than silently dropped.
 */
create or replace function public.import_gameweek_picks(
  p_league_id   uuid,
  p_gameweek_id uuid,
  p_entries     jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
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
  if v_uid is null then
    raise exception 'You need to be signed in.';
  end if;

  select * into v_league from public.leagues where id = p_league_id;
  if not found then raise exception 'Group not found.'; end if;

  if not (v_league.owner_id = v_uid or public.is_admin()) then
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

    -- The player's division in this group, this season.
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

    -- The fixture has to belong to the gameweek being imported.
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

  -- Score it straight away: the results are already in.
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
  to authenticated;
