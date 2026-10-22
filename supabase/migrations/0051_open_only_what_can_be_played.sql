-- ============================================================
--  0051 — "are there fixtures?" has to mean "for this league"
--
--  open_due_drafts guards against opening a draft for a gameweek with
--  nothing left to take:
--
--    select count(*) from fixtures
--     where gameweek_id = ... and status = 'scheduled' and kickoff_at > now()
--
--  That was every fixture in the gameweek, which until 0049 was the same
--  thing as every fixture anybody could pick. It is not any more. Following
--  six leagues for ratings puts their fixtures in every gameweek, live ones
--  included: GW18, being drafted tonight, holds 99 fixtures of which 53 are
--  Spanish, Italian, German, French, Dutch or Portuguese and on nobody's
--  card. The number the guard reads is now mostly fixtures no league plays.
--
--  Nothing has broken because of it. Every gameweek is cut from the English
--  spine, so a gameweek with foreign fixtures and no English ones cannot
--  exist today. But the guard reads a number that no longer means what it
--  says, and the thing it protects against — a draft opened over an empty
--  card, where players are handed turns with nothing to take — is the sort
--  of thing that surfaces as five people unable to pick rather than as an
--  error.
--
--  The real question is per league, because the card is. So it is asked
--  where the card is already in hand: start_drafts_for_gameweek skips a
--  division whose league has nothing in this gameweek, and open_due_drafts'
--  outer guard counts only fixtures some league plays, which is enough to
--  decide whether the gameweek is worth walking at all.
--
--  Core competitions are seeded into every league, so "some league plays it"
--  covers them without naming them.
-- ============================================================

create or replace function public.open_due_drafts()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_gw       record;
  v_fixtures integer;
  v_opened   integer := 0;
begin
  for v_gw in
    select id, number
      from public.gameweeks
     where draft_opens_at  <= now()
       and draft_closes_at >  now()
       and status in ('upcoming', 'drafting')
     order by number
  loop
    -- Fixtures somebody can actually take. A competition we follow only to
    -- rate its clubs has no league_competitions row anywhere, so it does
    -- not count towards a gameweek being worth opening.
    select count(*) into v_fixtures
      from public.fixtures f
     where f.gameweek_id = v_gw.id
       and f.status      = 'scheduled'
       and f.kickoff_at  > now()
       and exists (
         select 1 from public.league_competitions lc
          where lc.competition_id = f.competition_id
       );

    if v_fixtures = 0 then
      continue;
    end if;

    v_opened := v_opened + public.start_drafts_for_gameweek(v_gw.id);
  end loop;

  return v_opened;
end;
$$;

revoke all on function public.open_due_drafts() from public, anon, authenticated;
grant execute on function public.open_due_drafts() to service_role;


-- ------------------------------------------------------------
--  And per division, where the card is known
-- ------------------------------------------------------------
--
--  Same function as 0044 with one more condition on the loop: a league with
--  nothing in this gameweek does not get a draft opened over an empty card.
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
    select d.id, d.rotation_offset,
           coalesce(l.picks_per_player, 3) as picks,
           array(
             select lc.competition_id
               from public.league_competitions lc
              where lc.league_id = l.id
           ) as competitions
      from public.divisions d
      join public.leagues l on l.id = d.league_id
     where d.season_id = v_gw.season_id
       and not exists (
         select 1 from public.drafts dr
          where dr.division_id = d.id and dr.gameweek_id = p_gameweek_id
       )
       and not exists (
         select 1
           from public.drafts dr
           join public.gameweeks g on g.id = dr.gameweek_id
          where dr.division_id = d.id
            and dr.status <> 'complete'
            and g.season_id   = v_gw.season_id
            and g.number      < v_gw.number
       )
       -- Something for this league to take. Without it a group whose card
       -- is empty this week would have its players handed turns over
       -- nothing, which reads as the app being broken rather than as a
       -- gameweek they sit out.
       and exists (
         select 1
           from public.fixtures f
           join public.league_competitions lc
             on lc.competition_id = f.competition_id
            and lc.league_id = l.id
          where f.gameweek_id = p_gameweek_id
            and f.status      = 'scheduled'
            and f.kickoff_at  > now()
       )
  loop
    select array_agg(dm.user_id order by dm.seat, dm.user_id)
      into v_order
      from public.division_members dm
     where dm.division_id = v_div.id;

    v_n := coalesce(array_length(v_order, 1), 0);
    continue when v_n = 0;

    v_shift := (v_gw.number - 1 + coalesce(v_div.rotation_offset, 0)) % v_n;
    if v_shift > 0 then
      v_order := v_order[v_shift + 1 : v_n] || v_order[1 : v_shift];
    end if;

    insert into public.drafts
      (division_id, gameweek_id, status, pick_order, current_turn,
       picks_per_player, competition_ids, turn_started_at, turn_expires_at)
    values
      (v_div.id, p_gameweek_id, 'active', v_order, 0,
       v_div.picks,
       v_div.competitions,
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
grant execute on function public.start_drafts_for_gameweek(uuid) to service_role;
