-- ============================================================
--  0045 — which cups need their entry list cutting down
--
--  Turning the Champions League on for a group found a rule in the fixture
--  ingest that was written about the FA Cup and applied to every cup:
--
--    "A cup tie is kept when at least one side appears in this run's league
--     fixtures."
--
--  That rule earns its keep. The provider lists every round of the FA Cup,
--  qualifying included, and the ties where both sides are non-league brought
--  in 224 clubs and a hundred-odd fixtures a weekend that nobody can
--  sensibly call. Keeping only ties that touch one of the 92 is right.
--
--  It is quite wrong for a European competition. A group that turns the
--  Champions League on and nothing else holds no league fixtures for Real
--  Madrid or Bayern, so Real Madrid v Bayern — the fixture they actually
--  wanted — gets dropped, while Arsenal's tie survives because Arsenal is in
--  the Premier League. Half a competition, silently.
--
--  So the property moves onto the row instead of being inferred from "is it
--  a cup". `is_core` was available and would have worked today, but it means
--  "part of the game for everyone", and overloading it would be the same
--  mistake 0043 just undid for `tier`: one column answering two unrelated
--  questions, right until the day somebody adds a core competition that
--  shouldn't be pruned.
--
--  True for the two English cups, which is exactly today's behaviour. False
--  for everything else, so an opt-in competition arrives whole.
-- ============================================================

alter table public.competitions
  add column if not exists prune_to_known_sides boolean not null default false;

comment on column public.competitions.prune_to_known_sides is
  'Drop a tie in this competition unless one side also appears in a league we hold fixtures for. True for the FA Cup, whose qualifying rounds run far below the 92. False for an opt-in competition, which arrives whole.';

update public.competitions
   set prune_to_known_sides = true
 where code in ('FAC', 'EFLC');
