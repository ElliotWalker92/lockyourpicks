-- ============================================================
--  0040 — a rating nobody computed is not a rating
--
--  `elo_rating numeric(7,2) not null default 1500` meant every club had a
--  rating from the moment its row was written, whether or not anything had
--  ever been computed for it. 1500 is the Premier League seed, so a club we
--  know nothing about arrived priced as a Premier League side.
--
--  Ten clubs are in that state right now — Alvechurch, Cray Wanderers,
--  Stafford Rangers, Worcester City, Altrincham and five more — because they
--  exist only as FA Cup first-round entrants. They play on 7 November, and
--  until then:
--
--    * the model shows a confident read on Plymouth v Alvechurch built from
--      1500 v 1500, which says the tie is level bar home advantage;
--    * auto_pick, ordering by abs(home + 100 - away), scores every one of
--      those ten fixtures at exactly 100 and calls the home side — so it
--      backs Altrincham, of the National League, over Notts County.
--
--  The default is the cause in both cases, so it goes. The column becomes
--  nullable, which makes "we have not rated this club" something the data
--  can actually say, and forces every reader to answer it rather than
--  quietly inheriting 1500.
--
--  The Elo job decides who gets a rating (see src/lib/ingest/elo.ts): a club
--  with results we hold, or one playing in a competition with a tier, which
--  is enough to seed it somewhere sensible in the pyramid. A non-league cup
--  entrant has neither, and now gets null rather than a number.
-- ============================================================

alter table public.teams alter column elo_rating drop default;
alter table public.teams alter column elo_rating drop not null;

comment on column public.teams.elo_rating is
  'Null when nothing has been computed for this club — no results we hold and no division to seed it from. Do not substitute a number for null; that is what this migration removed.';

-- The clubs the job has never stamped are exactly the ones still carrying the
-- old default. Anything it has rated keeps its rating.
update public.teams
   set elo_rating = null
 where elo_updated_at is null;


-- ------------------------------------------------------------
--  auto_pick: don't take a fixture we can't price
-- ------------------------------------------------------------
--
--  Same function as 0010 with the ordering changed. Two differences:
--
--    * `edge is not null` sorts first, so a fixture with two rated sides is
--      always preferred to one without. Left to itself, `order by abs(edge)
--      desc` would do the opposite — descending puts nulls first in Postgres,
--      so the unrated ties would have gone to the front of the queue.
--    * if only unpriceable fixtures are left, it still picks one, because
--      the player's slip has to be filled. Home advantage is then the only
--      thing on the table, so it calls HOME and says nothing more.

create or replace function public.auto_pick(p_draft_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_draft   public.drafts%rowtype;
  v_uid     uuid;
  v_made    integer;
  v_next    integer;
  v_choice  record;
  v_outcome public.outcome;
  v_added   integer := 0;
begin
  select * into v_draft from public.drafts where id = p_draft_id for update;
  if not found or v_draft.status <> 'active' then return 0; end if;

  v_uid := public.draft_user_at_turn(v_draft.pick_order, v_draft.current_turn);
  if v_uid is null then return 0; end if;

  select count(*) into v_made
    from public.picks where draft_id = p_draft_id and user_id = v_uid;

  while v_made < v_draft.picks_per_player loop
    select f.id as fixture_id,
           (ht.elo_rating + 100 - at.elo_rating) as edge
      into v_choice
      from public.fixtures f
      join public.teams ht on ht.id = f.home_team_id
      join public.teams at on at.id = f.away_team_id
     where f.gameweek_id = v_draft.gameweek_id
       and f.status      = 'scheduled'
       and f.kickoff_at  > now()
       and not exists (
         select 1 from public.picks p
          where p.draft_id = p_draft_id and p.fixture_id = f.id
       )
     order by (ht.elo_rating is not null and at.elo_rating is not null) desc,
              abs(ht.elo_rating + 100 - at.elo_rating) desc,
              f.kickoff_at asc
     limit 1;

    exit when not found;

    -- A null edge means one of the sides is unrated, and coalesce makes the
    -- fallback explicit: with nothing to compare, back the home side.
    v_outcome := case when coalesce(v_choice.edge, 0) >= 0 then 'HOME' else 'AWAY' end::public.outcome;

    select coalesce(max(pick_number), -1) + 1 into v_next
      from public.picks where draft_id = p_draft_id;

    insert into public.picks
      (draft_id, user_id, fixture_id, predicted_outcome, pick_number, is_auto_pick)
    values
      (p_draft_id, v_uid, v_choice.fixture_id, v_outcome, v_next, true);

    v_made  := v_made + 1;
    v_added := v_added + 1;
  end loop;

  perform public.advance_draft_turn(p_draft_id);
  return v_added;
end;
$$;

revoke all on function public.auto_pick(uuid) from public, anon, authenticated;
grant execute on function public.auto_pick(uuid) to service_role;
