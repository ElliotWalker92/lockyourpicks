# Lock Your Picks — v2 Design

Overhaul of the WC2026 predictor into a season-long English football draft-prediction
game. This document captures decisions made so far, the proposed data model, and the
open questions.

Status: draft, pending review. Nothing built yet.

**Source of truth:** `Betting League 23_24.xlsx` — the spreadsheet the game has been run
from. Sections below marked *(confirmed from sheet)* are read directly out of it.
It is a blank 23/24 template: structure and formulas are intact, no historical results,
so there is nothing to migrate.

---

## 1. The game

Players predict results in English football. Each gameweek, every player picks
**3 fixtures** and predicts each one's outcome. **1 point per correct result.** Points
accumulate to a season leaderboard.

*(Confirmed from sheet.)* Each pick is four fields — `HOME`, `PRED.`, `AWAY`, `RES.` —
and scoring is literally `=IF(PRED=RES, 1, 0)`. Both `PRED.` and `RES.` hold a **team
name**, or `-` for a draw: you name the team you think wins rather than choosing
home/draw/away. Same information, and the app should keep this encoding since it is how
players already think about it.

The team dropdown holds **100 clubs spanning all four English tiers** — Premier League
through League Two (Accrington Stanley, Barrow, AFC Wimbledon are all present). The list
is stale in places: Bury and Macclesfield Town both went defunct, so v2 should source
clubs live rather than hardcode them.

The spreadsheet has **57 week-columns**, but that looks like padding rather than a real
season length — 57 weeks from August runs to the following September. An August-to-May
season is **43 Tuesday-to-Monday weeks**, which is what `buildWindows` generates. Worth
confirming, but a few unused trailing gameweeks are harmless either way.

### The USP: exclusive drafting

Fixtures are **drafted, not freely chosen**. Within a mini-league, once a player claims
a fixture nobody else in that mini-league can pick it. Players take turns, and the
turn order rotates each gameweek so everyone gets first pick in rotation.

This is what makes the game: you're not just predicting, you're choosing which
predictions to deny your rivals — and picking late means eating whatever's left.

### Structure

*(Confirmed from sheet — 9 players, 3 divisions of 3.)*

```
Betting League  (9 players, one Overall Table)
  ├── Division 1  — Matt Le Tissier, Thullio Dias Viera, Richard Pink
  ├── Division 2  — Elliot Walker, Teal Gill, Bryce Norman
  └── Division 3  — Sean Gillease, Martin Bradley, Seb Locke
```

The sheet keeps a **table per division plus one Overall Table** ranking all 9 on the
same points, which is exactly the "smaller leaderboards within a larger leaderboard"
structure. Divisions are fixed for the season; movement between them happens at season
rollover (a new workbook per season — `23_24` here).

- The **league** is the social unit — one join code, one overall leaderboard.
- **Mini-leagues** are divisions within it. The admin sets players-per-mini.
- Drafting happens **within a mini-league**, not across the whole league. Two players
  in different minis can both hold the same fixture.
- At **season end, players move between tiers** — promotion and relegation, like the
  English pyramid. (Exact up/down counts: open question.)

---

## 2. Decisions locked in

| Decision | Choice |
|---|---|
| Competitions | All four English tiers (PL, Champ, L1, L2) + cups |
| Picks per player per gameweek | 3 |
| Prediction format | Name the winning team, or `-` for a draw |
| Scoring | 1 pt per correct result. No scoreline bonus. |
| Season length | ~43 gameweeks (Aug–May, Tue→Mon weeks) |
| Mini-league size | 3 players (9 players → 3 divisions) |
| Fixture exclusivity | Within mini-league only |
| Draft timing | Asynchronous — each player gets a turn window |
| Missed turn | Auto-pick on their behalf |
| Mini-league purpose | Smaller leaderboards + promotion/relegation between tiers |
| Stack | Next.js (App Router) + TypeScript + Supabase, hosted on Vercel |

---

## 3. Draft mechanics

### Turn length is derived, not fixed

A mini-league of *N* players making 3 picks each is **3N sequential turns** — 9 turns
for a mini of 3. A fixed 24h turn window would take 9 days and overrun the gameweek.

Instead:

```
draft_opens_at    = when the previous gameweek settles
draft_closes_at   = first kickoff of this gameweek
turn_duration     = (draft_closes_at − draft_opens_at) ÷ (3 × N)
```

For a Monday 00:00 → Saturday 12:00 window with 9 turns, that's ~14.6h per turn. Every
draft is therefore guaranteed to finish before the first ball is kicked, regardless of
how many players go quiet.

Players who pick promptly hand time back to the pool, so in practice most drafts
finish early. (Optional refinement: recompute remaining turn length after each pick so
early picks lengthen later turns rather than wasting the slack.)

### Turn order: snake

Recommended over a plain rotation, because it's self-balancing within a single
gameweek:

```
Round 1:  A → B → C
Round 2:  C → B → A
Round 3:  A → B → C
```

The first picker in round 1 picks last in round 2. On top of that, the **starting
player rotates each gameweek** (GW1 starts A, GW2 starts B, GW3 starts C), so nobody
holds the first-overall pick two weeks running.

### Auto-pick

When a turn expires, the system picks for that player using the **existing Elo model**
(see §5): take the available fixture with the highest-confidence outcome and predict
that outcome. This reuses `js/elo.js` essentially unchanged and gives a defensible,
non-random fallback.

Picks made this way are flagged `is_auto_pick` so the UI can show them honestly.

### Pick = claim + prediction, atomically

**Assumption to confirm:** taking your turn means claiming the fixture *and* stating
your prediction in one action. The alternative — draft fixtures now, predict later —
needs a second deadline and more UI, for little gain.

---

## 3a. The money layer — **PHASE 2, deferred**

Not in phase 1. Captured here so the phase-1 data model doesn't paint us into a corner.

The intent: **each division places one accumulator built from its 9 selections**
(3 players × 3 picks), which matches what the workbook shows. Phase 1 should therefore
keep picks queryable as a per-division, per-gameweek set of 9 — which the model in §4
already does — so the acca can be assembled later without reshaping anything.

**Subscriptions.** The `Paid` sheet is a ledger over all 9 players: each owes
**£5 per gameweek** (`= gameweeks_elapsed × 5`), tracked against what they've actually
paid, giving a running balance owed. There's a single gameweek counter cell driving the
whole sheet.

**The accumulator.** `£15 per gameweek` is taken off the top into an "Acca Total", with
the remainder forming the **Pot**. Each division's fixtures sheet has an
**`Acca winnings`** row per gameweek. Reading those together, the likely mechanic is
that each division stakes £5 a week on an accumulator built from its own picks — 3
divisions × £5 = the £15 — and any winnings are recorded per division.

```
9 players × £5/gameweek  =  £45 per gameweek collected
                          − £15 to the accumulator stake
                          =  £30 into the pot
```

When phase 2 is scoped, note the distinction: recording who owes what is ordinary
bookkeeping, but actually placing accumulators, handling payments, or moving money
between players brings in payment processing and UK gambling regulation. That deserves
deliberate scoping (and probably legal input) rather than being absorbed as an extension
of the prediction game.

---

## 4. Data model (proposed)

```sql
seasons        (id, name, starts_on, ends_on, is_active)

competitions   (id, code, name, provider, provider_id, is_active)
               -- e.g. PL, ELC, FAC

teams          (id, name, short_name, tla, crest_url, provider_id,
                elo_rating, elo_updated_at)

gameweeks      (id, season_id, number,
                draft_opens_at, draft_closes_at, first_kickoff_at,
                status)          -- upcoming | drafting | locked | live | settled

fixtures       (id, gameweek_id, competition_id,
                home_team_id, away_team_id, kickoff_at,
                status, home_score, away_score,
                result,          -- H | D | A, derived once finished
                provider_match_id UNIQUE)

leagues        (id, name, join_code, owner_id, season_id,
                mini_league_size, created_at)

league_members (league_id, user_id, joined_at)

mini_leagues   (id, league_id, season_id, name, tier)

mini_league_members (mini_league_id, user_id, season_id)

drafts         (id, mini_league_id, gameweek_id, status,
                pick_order,          -- ordered user_ids for this gameweek
                current_turn_index, turn_started_at, turn_expires_at,
                UNIQUE (mini_league_id, gameweek_id))

picks          (id, draft_id, user_id, fixture_id,
                predicted_result,    -- H | D | A
                pick_number, is_auto_pick, points_awarded, created_at,
                UNIQUE (draft_id, fixture_id))   -- ← exclusivity, enforced by the DB

gameweek_scores (user_id, gameweek_id, mini_league_id, points, correct_count)
```

### Two constraints that must live in the database

**Exclusivity.** `UNIQUE (draft_id, fixture_id)` on `picks`. Two players hitting
"pick" on the same fixture in the same second is the *normal* case near a deadline, not
an edge case. A client-side check cannot prevent it; a unique index can.

**Turn order.** A `SECURITY DEFINER` Postgres function — `make_pick(draft_id,
fixture_id, predicted_result)` — that validates in one transaction that it is the
caller's turn, that the turn hasn't expired, and that the fixture is unclaimed, then
inserts. RLS policies alone can't express "it's your turn"; this can, atomically.

This also fixes a live bug inherited from v1: `isRoundLocked()` in
`js/supabase-client.js` is a **client-side** check, so a user could POST a prediction
after kickoff. In a weekly game decided by single points, that's exploitable. All
deadline enforcement moves server-side.

---

## 5. What carries over from WC2026

**Kept close to as-is**
- `js/elo.js` — pure, sport-agnostic Elo → win/draw/loss probabilities. Its
  `HOME_ADV = 100` is *more* appropriate for domestic football than it was for
  neutral-venue World Cup matches. Also powers auto-pick.
- `js/match-probs.js` — Elo/crowd blend. Better suited to this game than the last one:
  in a draft, the crowd distribution tells you which fixtures players actually trust.
- Auth, profiles, invite codes, league join-codes, realtime subscription pattern.
- `css/style.css` — the design system, restyled.

**Reworked, architecture retained**
- `supabase/functions/fetch-results` — server-side provider call, admin auth,
  service-role upsert is all sound. The hardcoded WC fixture mapping is replaced by
  matchday-based fetching into the `fixtures` table.
- `auto-update` cron — same pattern, new guts.

**Retired**
- `js/data.js` (WC teams/groups/fixtures), all eight `pages/roundN.html`,
  `standings.html`, `calculator.html`, every bracket-propagation routine, and ~90% of
  `js/scoring.js`. The new scoring rule is one line; the complexity moves into draft
  state and mini-league standings.

---

## 6. Known constraints and risks

**Fixture supply caps division size at 3 — measured, not estimated.**

Ingesting the real 2026/27 season (2,094 fixtures across PL, Championship, League One,
League Two and the EFL Cup) gives 43 gameweeks with:

```
fixtures per gameweek:  min 10   median 46   max 92
```

A division of *N* needs 3N fixtures. Exclusivity is *within* a division, so several
divisions can draft the same fixture — division **count** is irrelevant, only **size**
matters:

| Division size | Fixtures needed | Gameweeks that can't fill it |
|---|---|---|
| 2 | 6 | 0 |
| **3** | **9** | **0** ✅ |
| 4 | 12 | 3 |
| 5 | 15 | 3 |

**Three players per division is exactly the largest size that works every week of the
season.** Four breaks in three gameweeks — the international-break weeks, which carry
only 10 fixtures across all six competitions combined.

The spreadsheet's choice of 3 turns out to be the only size that never fails. That's
almost certainly not a coincidence.

Consequences:
- The create-league form should warn when a size above 3 is chosen, since the failure
  won't appear until an international break mid-season.
- Supply is season-specific. Re-run this check each season rather than assuming 3 stays
  safe.
- Adding the FA Cup (once published) would widen the thin weeks — its early rounds fall
  in exactly the weeks the leagues go quiet.

**Data provider — see §6a. Recommendation: switch to API-Football.**

**Postponements.** A drafted fixture that gets called off has consumed a player's pick.
Rule needed: void and re-pick, roll to the rearranged date, or score as zero.

**Schema drift in v1.** `leagues` and `league_members` are used throughout
`js/supabase-client.js` but appear in **no committed SQL file** — they were created
directly in the Supabase dashboard. v2 keeps the entire schema in migrations.

---

## 6a. Data provider

**Verified against a real API-Football key on 13 Aug 2026** — the numbers below are
measured, not quoted from documentation.

### League IDs — confirmed correct

All six seeded in `0004_seed_reference_data.sql` check out against
`/leagues?country=England`:

| ID | Competition | Current season |
|---|---|---|
| 39 | Premier League | 2026 |
| 40 | Championship | 2026 |
| 41 | League One | 2026 |
| 42 | League Two | 2026 |
| 45 | FA Cup | **2025** ⚠️ |
| 48 | League Cup | 2026 |

⚠️ The FA Cup still reports 2025 as current — its 2026/27 edition isn't published yet.
Ingestion must tolerate a competition whose current season lags the others, rather than
assuming `season = 2026` everywhere.

Also available if ever wanted: EFL Trophy (46), Community Shield (528), National League
(43).

### The free plan cannot run this game

An earlier draft of this document claimed the free tier was sufficient if fixtures were
fetched by date. **That was wrong.** The binding constraint is not request volume, it's
data access:

```
/fixtures?season=2026   → "Free plans do not have access to this season,
                           try from 2022 to 2024."
/fixtures?date=2026-08-15 → "Free plans do not have access to this date,
                             try from 2026-08-12 to 2026-08-14."
```

The free plan sees a rolling **today ±1 day** window, and historical seasons 2022–2024.
Nothing further ahead than tomorrow, ever. A draft resolves *before* the gameweek, so
there is no way to arrange the free plan into something workable — the 100 requests/day
allowance is irrelevant.

### Real options

| Option | Coverage | Forward visibility | Cost |
|---|---|---|---|
| API-Football Free | all competitions | today ±1 day | £0 — **unusable** |
| **API-Football Pro** | all competitions | full | **$19/mo** |
| **football-data.org Free** | PL + Championship only | full | **£0** |
| football-data.org Tier 2 | all 4 tiers + cups | full | €99/mo |

Two defensible paths:

1. **All four tiers and cups → API-Football Pro, $19/mo (~£15).** Still five times
   cheaper than football-data.org's €99/mo for the same coverage.
2. **Start at zero → football-data.org free tier.** PL (10) + Championship (12) = 22
   fixtures a week, live and current. That comfortably feeds divisions of 3 (9 needed)
   and scales to 7 players per division. No League One, League Two or cups — a real
   narrowing against the spreadsheet, but the game runs. v1 already has working
   football-data ingestion code in `legacy/` to crib from.

The choice is a product one: is drafting from the lower tiers and cups part of what
makes the game, or is the Premier League and Championship slate enough to start?

---

## 7. Open questions

**Answered by the sheet:** competitions (all four English tiers), mini-league size (3),
division structure, scoring formula, prediction encoding, season length (57 gameweeks).

**Still open:**

1. ~~The money layer~~ — **deferred to phase 2** (§3a). Each division places one acca
   from its 9 selections.
2. ~~Data provider~~ — **API-Football recommended** (§6a), pending the one-call coverage
   check.
3. **Promotion/relegation** — the sheet has no P/R mechanics at all; divisions are fixed
   within a season and a new workbook starts each year. How many up and down, and is it
   automatic at rollover?
4. **The draft is genuinely new.** Nothing in the workbook encodes turn order, pick
   order, or timestamps — no column for who picked first, no deadline. The turn-taking
   and fixture exclusivity you described must currently be handled socially, by
   agreement. So the draft isn't a feature being ported; it's the feature being
   *invented*, and the spreadsheet offers no precedent to copy. Worth confirming how it
   works in practice today before it gets formalised in code.
5. Tiebreaks — the Overall Table sorts on total points with no secondary criterion.
6. Postponements — a drafted fixture that's called off has consumed a pick.
7. Can a player be in more than one league at once? (v1 allowed it.)
8. Does the crowd-percentage stat still make sense when picks are exclusive, or should
   it become something else (how often a fixture is drafted, and how early)?
