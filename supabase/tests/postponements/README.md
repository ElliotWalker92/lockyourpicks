# Postponements — what happens to a pick when the game goes off

Sixteen assertions over the two rules, which look identical from the status
change alone and want opposite things:

1. **The game was already known to be off when they picked it.** Our data
   had not caught up, they have spent a pick on nothing, so it comes back
   and they are told. This is not hypothetical: the ingest put six
   called-off games back on the board, four players picked them, and the
   ingest then agreed they were off after all.
2. **The game was on when they picked it and went off afterwards.** The
   pick stands and scores whenever the match is replayed, because the
   provider keeps the same fixture id, our ingest moves the row to the
   gameweek the new date falls in, and the pick goes with it.

What tells them apart is `fixtures.postponed_at` — the *first* time we saw
the game was off, deliberately not moved by seeing it again.

The suite also covers what follows: a postponed pick is pending rather
than nil at settlement, a cancelled one is nil, the clock fills whoever is
still short once picking closes, a closed round is left alone, 0061's
override still holds, and a stored total that has gone stale because a
pick scored late is rewritten from the picks behind it.

Written because the behaviour was got wrong in production twice — once
when the ingest overwrote six admin postponements (0061), and again when
it postponed a fixture by itself and left the pick sitting on it for
thirty-three hours (0062, 0063).

## Running it

The setup expects a local stack with no leagues or fixtures of its own, so
reset first. It is not idempotent — a second run on the same database
fails on its own test data, which is the intended signal to reset.

```
npx supabase db reset
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/postponements/setup.sql
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/postponements/test.sql
```

`$DB` is the local database URL. The port is in `supabase/config.toml`,
not the Supabase default. Each assertion raises on failure, so a clean run
ends with `ALL ASSERTIONS PASSED` and anything else stops at the first
problem.

The setup leans on what the migrations already seed — the active season
and the real competition codes — rather than inventing its own, because a
season row that trips `seasons_single_active` is a failure that teaches
you nothing.
