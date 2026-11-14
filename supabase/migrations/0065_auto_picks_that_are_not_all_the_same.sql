-- ============================================================
--  Auto-picks that are not all the same slip
--
--  `auto_fill_player` takes the single biggest Elo mismatch left on the
--  board, which is the same fixture for everybody. Drafts are per division
--  and only exclude fixtures taken in their own draft, so three players
--  auto-picked in three different divisions this gameweek came out with
--  the same four home wins — Salford, Crewe, Fleetwood, Port Vale, in that
--  order, every time. It is defensible arithmetic and it reads like
--  collusion.
--
--  So the choice is now made from a shortlist rather than from the top of
--  the list. The ranking is unchanged — rated sides first, biggest
--  mismatch next, earliest kickoff to break a tie — and the pick is
--  whichever of the best few the player's own id sorts first.
--
--  Hashed on the player rather than random, for three reasons: the same
--  player filled twice in a row gets the same answer, so a retry cannot
--  quietly change somebody's slip; it needs no seed and no state; and it
--  is reproducible when somebody asks why they got Crewe. `md5` over the
--  pair, not over the player alone, because a per-player constant would
--  only rotate the same ordering for everyone.
--
--  A shortlist of eight, from a card of twenty-odd draftable fixtures: wide
--  enough that two players rarely lead with the same game, narrow enough
--  that every option is still a real mismatch rather than a coin toss. The
--  quota is taken one fixture at a time and the shortlist is recomputed
--  each time with that draft's picks excluded, so two slips that do start
--  the same diverge after it.
-- ============================================================

create or replace function public.auto_fill_player(
  p_draft_id uuid,
  p_user_id  uuid
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_draft   public.drafts%rowtype;
  v_cards   uuid[];
  v_made    integer;
  v_next    integer;
  v_choice  record;
  v_outcome public.outcome;
  v_added   integer := 0;
  -- How many of the best to choose among. Named rather than inline
  -- because it is the one number that trades spread against quality.
  v_shortlist constant integer := 8;
begin
  select * into v_draft from public.drafts where id = p_draft_id;
  if not found then return 0; end if;

  v_cards := public.draft_competitions(p_draft_id);

  select count(*) into v_made
    from public.picks where draft_id = p_draft_id and user_id = p_user_id;

  while v_made < v_draft.picks_per_player loop
    with board as (
      select f.id as fixture_id,
             (ht.elo_rating + 100 - at.elo_rating) as edge,
             row_number() over (
               order by (ht.elo_rating is not null and at.elo_rating is not null) desc,
                        abs(ht.elo_rating + 100 - at.elo_rating) desc,
                        f.kickoff_at asc
             ) as rank
        from public.fixtures f
        join public.teams ht on ht.id = f.home_team_id
        join public.teams at on at.id = f.away_team_id
       where f.gameweek_id    = v_draft.gameweek_id
         and f.competition_id = any (v_cards)
         and f.status         = 'scheduled'
         and f.kickoff_at     > now()
         and not exists (
           select 1 from public.picks p
            where p.draft_id = p_draft_id and p.fixture_id = f.id
         )
    )
    select fixture_id, edge
      into v_choice
      from board
     where rank <= v_shortlist
     order by md5(p_user_id::text || fixture_id::text)
     limit 1;

    exit when not found;

    -- A null edge means one of the sides is unrated, and coalesce makes
    -- the fallback explicit: with nothing to compare, back the home side.
    v_outcome := case when coalesce(v_choice.edge, 0) >= 0 then 'HOME' else 'AWAY' end::public.outcome;

    select coalesce(max(pick_number), -1) + 1 into v_next
      from public.picks where draft_id = p_draft_id;

    insert into public.picks
      (draft_id, user_id, fixture_id, predicted_outcome, pick_number, is_auto_pick)
    values
      (p_draft_id, p_user_id, v_choice.fixture_id, v_outcome, v_next, true);

    v_made  := v_made + 1;
    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$$;

revoke all on function public.auto_fill_player(uuid, uuid) from public, anon, authenticated;

comment on function public.auto_fill_player(uuid, uuid) is
  'Fills a player up to their quota with auto-picks, choosing from the '
  'eight best fixtures left rather than the single best, ordered by a hash '
  'of the player and the fixture. Same player, same answer every time — '
  'but three players filled in three divisions no longer come out with '
  'identical slips.';
