-- ============================================================
--  0046 — the Champions League is not the Champions League
--
--  Turning it on for one group and watching what arrived: 234 fixtures, of
--  which 90 are the qualifying path.
--
--    2026-07-07   28  1st Qualifying Round
--    2026-07-21   28  2nd Qualifying Round
--    2026-08-04   20  3rd Qualifying Round
--    2026-08-18   14  Play-offs
--    2026-09-08   18  League Stage - 1        ← the competition proper
--    ...
--
--  The provider puts all of it under league id 2, so "plays in the Champions
--  League" spans Real Madrid and Tre Fiori of San Marino. That matters twice
--  over.
--
--  It brought in 76 clubs we hold nothing else for, most of which will never
--  appear in a fixture anybody can pick — and all of them inherited the
--  competition's elo_seed of 1500, which is the Premier League number. So
--  Lincoln Red Imps, Atert Bissen and Inter Club d'Escaldes arrived rated
--  level with Manchester City. That is precisely the bug 0040 through 0043
--  were about, let back in through the seed of an opt-in competition.
--
--  Two changes. The qualifying path isn't ingested at all, by name, per
--  competition — the names are the provider's wording, and an explicit list
--  beats inferring it, because "Play-offs" means the qualifying play-off
--  round here and the promotion play-offs in the Championship. A pattern
--  clever enough to tell those apart would be clever enough to get it wrong
--  quietly. The ingest reports how many it skipped per competition instead,
--  so provider wording drifting shows up as a number going to zero rather
--  than as San Marino back in the fixture list.
--
--  And the European seeds come down. Even restricted to the league phase,
--  the field runs from Real Madrid to Kairat Almaty, so a number near the
--  top of our scale is wrong for most of it. These are scaffolding rather
--  than estimates: the Elo job stores last season for every competition in
--  play, so a club that was in it last year gets a rating from real results
--  within one run, and the seed only ever covers a debutant.
-- ============================================================

alter table public.competitions
  add column if not exists skip_rounds text[] not null default '{}';

comment on column public.competitions.skip_rounds is
  'Provider round names not to ingest — the qualifying path of a European competition, which it publishes under the same league id as the competition proper. The provider''s own wording, matched exactly; the ingest reports the count it skipped so a change in wording is visible.';

update public.competitions
   set skip_rounds = array[
         '1st Qualifying Round',
         '2nd Qualifying Round',
         '3rd Qualifying Round',
         'Preliminary Round',
         'Preliminary Semi-finals',
         'Preliminary Final',
         'Play-offs'
       ]
 where code in ('UCL', 'UEL', 'UECL');


-- Scaffolding, not an estimate. See the header.
update public.competitions set elo_seed = 1400 where code = 'UCL';
update public.competitions set elo_seed = 1300 where code = 'UEL';
update public.competitions set elo_seed = 1200 where code = 'UECL';
