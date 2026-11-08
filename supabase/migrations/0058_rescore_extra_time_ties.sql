-- ============================================================
--  Correct five cup ties scored on the extra-time result
--
--  Reported by a player: Stockport were level at full time and won in
--  extra time, and the game paid out a point for an away win.
--
--  The ingest stored the provider's `goals`, which folds extra time in.
--  The score this game has always meant by "the result" is the one
--  after ninety minutes -- nobody calls a tie that finished 2-2 an away
--  win. The code fix is in src/lib/ingest/results.ts; this repairs what
--  the old code wrote.
--
--  Every finished cup fixture in the database was checked against the
--  provider. Five carried the extra-time score; four of those had the
--  wrong result:
--
--    Oldham v Sheffield Wednesday    2-1 HOME -> 1-1 DRAW
--    AFC Hornchurch v Blackpool      1-2 AWAY -> 1-1 DRAW
--    Cray Wanderers v Stockport      2-3 AWAY -> 2-2 DRAW
--    Fleetwood Town v Rochdale       1-2 AWAY -> 1-1 DRAW
--    Stafford Rangers v Grimsby      3-3 DRAW -> 2-2 DRAW  (score only)
--
--  `fixtures.result` is a generated column, so correcting the scores
--  corrects the result. Re-running settle_gameweek then rescores the
--  picks and upserts gameweek_scores using the app's own logic rather
--  than anything hand-written here -- it is idempotent by design, which
--  is what makes a late correction safe.
--
--  Only two picks change, both on the Stockport tie, both from 1 to 0:
--  Pinky and Jordan each drop a point in Gameweek 22. The league table
--  is summed from gameweek_scores at read time, so it follows on its
--  own with nothing else to update.
-- ============================================================

update public.fixtures set home_score = 1, away_score = 1
 where id = '12cbbccd-bf4d-486c-b1be-4555aa555185';  -- Oldham v Sheffield Wednesday

update public.fixtures set home_score = 2, away_score = 2
 where id = '3357cd75-2ac1-4bc9-8778-6d12bd3b6c5d';  -- Stafford Rangers v Grimsby

update public.fixtures set home_score = 1, away_score = 1
 where id = '5e18ea12-0588-422f-8560-5be8e3f38c89';  -- AFC Hornchurch v Blackpool

update public.fixtures set home_score = 2, away_score = 2
 where id = '0f2ecf04-cbfe-416f-8e7b-146c43228c4c';  -- Cray Wanderers v Stockport County

update public.fixtures set home_score = 1, away_score = 1
 where id = '9d1a4acd-9411-47e9-85d7-dc958d6f1766';  -- Fleetwood Town v Rochdale

select public.settle_gameweek('281b79b2-f580-4b1d-a2ba-02e8673978e7');  -- Gameweek 22
