# 0062 — a postponement releases its picks

Twelve assertions over the behaviour migration 0062 introduces: a fixture
that goes off releases the picks on it whoever wrote the status, who gets
told, and who gets filled in by the clock.

The first such test in this repo, written because the bug it covers was
found in production twice — once when the ingest overwrote six admin
postponements (0061), and again when it postponed a fixture by itself and
left the pick sitting on it for thirty-three hours.

Run it against a local stack, which `setup.sql` expects to be empty of
leagues and fixtures:

```
npx supabase db reset
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/0062/setup.sql
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/0062/test.sql
```

`$DB` is the local database URL from `npx supabase status` — the port is
in `supabase/config.toml`, not the Supabase default. Each assertion raises
on failure, so a clean run ends with `ALL ASSERTIONS PASSED`; anything
else stops at the first problem.

The setup leans on what the migrations already seed (the active season and
the real competition codes) rather than inventing its own, because a
season row that disagrees with `seasons_single_active` is a test failure
that teaches you nothing.
