# Lock Your Picks

Season-long English football prediction game built around an **exclusive fixture
draft**. Each gameweek every player drafts 3 fixtures and calls the result; once
a fixture is taken inside your division nobody else there can have it. 1 point
per correct result.

The rules, the data model and the open questions live in
**[docs/game-design.md](docs/game-design.md)** — read that first.

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS 4 |
| Backend | Supabase (Postgres, Auth, Realtime) |
| Fixtures/results | API-Football (api-sports.io) |
| Hosting | Vercel |

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill it in
npm run dev
```

## Layout

```
src/
  app/                  routes
  lib/
    supabase/           client (browser), server (RSC/actions), session (proxy)
    actions/picks.ts    makePick server action → make_pick RPC
    elo.ts              Elo → win/draw/loss, ported from the WC2026 app
    types/database.ts   hand-written; regenerate once the project is linked
  proxy.ts              session refresh + route protection
supabase/migrations/    schema, draft engine, RLS
docs/game-design.md     game rules and design decisions
legacy/                 the archived WC2026 app (not built or linted)
```

## The one rule worth knowing before you touch anything

**Picks are never written directly.** `public.picks` has no INSERT policy and no
INSERT grant. The only way a pick reaches the table is
`make_pick(draft_id, fixture_id, outcome)`, a `SECURITY DEFINER` function that
takes a row lock on the draft and checks, in one transaction, that it is your
turn, that your turn hasn't expired, that the fixture is in this gameweek and
hasn't kicked off, and that nobody has already claimed it.

This isn't ceremony. The draft is adversarial by design — players gain by denying
each other fixtures — so turn order and exclusivity are exactly the rules players
are motivated to break, and a client-side check would be both bypassable and
unable to arbitrate two people clicking the same fixture in the same second.

The v1 app got this wrong: its deadline check lived in the browser. See
[docs/game-design.md](docs/game-design.md) §4.

## Database

Migrations are plain SQL in `supabase/migrations/`, applied in filename order.

| File | Contents |
|---|---|
| `0001_core_schema.sql` | Tables, enums, constraints |
| `0002_draft_functions.sql` | Snake order, `make_pick`, `auto_pick`, settlement |
| `0003_rls.sql` | Row level security and grants |

> **Not yet executed against a real Postgres.** They were written without a local
> database available, so run them against a scratch Supabase project before
> trusting them. Once a project is linked, regenerate the types:
>
> ```bash
> npx supabase gen types typescript --linked > src/lib/types/database.ts
> ```

## Legacy

`legacy/` holds the WC2026 predictor this replaces — a static site on GitHub
Pages that ran until the tournament finished in July 2026. Kept for reference
(its Elo model and scoring engine informed v2) and excluded from the build,
lint and typecheck.

Note that publishing this repo will no longer serve the old site from GitHub
Pages, since `index.html` has moved into `legacy/`.
