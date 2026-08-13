# ⚽ WC2026 Prediction Game

A full-featured World Cup 2026 prediction game for you and your friends. Hosted free on **GitHub Pages** (static frontend) + **Supabase** (auth, database, real-time).

---

## 🏗️ Project Structure

```
wc2026-predictor/
├── index.html                  # Home / landing page
├── css/
│   └── style.css               # Main stylesheet
├── js/
│   ├── config.js               # ← YOUR KEYS GO HERE
│   ├── data.js                 # Teams, groups, fixtures
│   ├── supabase-client.js      # DB helpers
│   ├── scoring.js              # Scoring engine
│   └── ui.js                   # Shared UI utilities
├── pages/
│   ├── auth.html               # Sign in / sign up
│   ├── leaderboard.html        # Live leaderboard
│   ├── predictions.html        # Predictions hub
│   ├── round1.html             # Pre-tournament questions
│   ├── round2.html             # Group winners
│   ├── round3.html             # Group stage scores (48 matches)
│   ├── round4.html             # Round of 32
│   ├── round5.html             # Round of 16
│   ├── round6.html             # Quarter Finals
│   ├── round7.html             # Semi Finals
│   ├── round8.html             # The Final
│   ├── matches.html            # Match centre
│   ├── my-predictions.html     # My picks & scoring
│   └── admin.html              # Admin panel
└── supabase/
    ├── schema.sql              # Database schema + RLS
    └── functions/
        └── recalculate-scores/
            └── index.ts        # Edge Function for auto-scoring
```

---

## 🚀 Setup Guide

### Step 1 — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Pick a name (e.g. `wc2026`), set a strong database password, choose a region
3. Wait ~2 minutes for provisioning

### Step 2 — Run the Database Schema

1. In your Supabase project, go to **SQL Editor**
2. Click **New Query**
3. Paste the entire contents of `supabase/schema.sql`
4. Click **Run**

This creates all tables, RLS policies, and seeds one invite code (`KICKOFF`).

### Step 3 — Get Your Supabase Keys

1. Go to **Project Settings → API**
2. Copy:
   - **Project URL** (e.g. `https://abcxyz.supabase.co`)
   - **anon / public key** (starts with `eyJ...`)

### Step 4 — Get a Football Data API Key

1. Register free at [football-data.org](https://www.football-data.org/client/register)
2. Copy your API key from the dashboard
3. The World Cup 2026 competition ID will be `2000` (verify once the tournament is listed)

### Step 5 — Configure the App

Open `js/config.js` and replace the placeholders:

```javascript
const CONFIG = {
  SUPABASE_URL:        'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY:   'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  FOOTBALL_API_KEY:    'your-football-data-api-key',
  ADMIN_EMAIL:         'your@email.com',
  APP_URL:             'https://YOUR-GITHUB-USERNAME.github.io/wc2026-predictor',
  // ... round lock times (pre-filled to WC2026 dates)
};
```

### Step 6 — Deploy to GitHub Pages

1. Push all files to a GitHub repo:
   ```bash
   git init
   git add .
   git commit -m "Initial WC2026 predictor"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/wc2026-predictor.git
   git push -u origin main
   ```

2. In your repo: **Settings → Pages → Source → Deploy from branch → main → / (root)**

3. GitHub Pages URL will be: `https://YOUR-USERNAME.github.io/wc2026-predictor`

### Step 7 — Set Yourself as Admin

1. Go to your deployed app and sign up with your email
2. In Supabase SQL Editor, run:
   ```sql
   SELECT set_admin_by_email('your@email.com');
   ```
3. Sign out and back in — you now have the Admin menu

### Step 8 — Deploy the Edge Function (for auto-scoring)

Install the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy recalculate-scores
```

### Step 9 — Enable Realtime

In Supabase Dashboard → **Database → Replication**, enable realtime on:
- `scores`
- `match_results`
- `predictions`

Or run in SQL Editor:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.scores;
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_results;
ALTER PUBLICATION supabase_realtime ADD TABLE public.predictions;
```

### Step 10 — Invite Your Friends

1. Go to **Admin → Invite Codes** and generate codes
2. Share the link (e.g. `https://yoursite.github.io/wc2026-predictor/pages/auth.html?invite=AB12CD`)
3. Friends click the link, enter the code, and sign up

---

## 🎮 How It Works

### Rounds & Scoring

| Round | Name | Matches | Scoring |
|-------|------|---------|---------|
| R1 | Pre-Tournament | 13 questions | 5–20 pts each |
| R2 | Group Winners | 24 picks | 10 pts correct, 5 pts partial |
| R3 | Group Stage Scores | 48 matches | 7 exact, 5 result |
| R4 | Round of 32 | 16 matches | 7 exact, 5 result |
| R5 | Round of 16 | 8 matches | 7 exact, 5 result |
| R6 | Quarter Finals | 4 matches | 7 exact, 5 result |
| R7 | Semi Finals | 2 matches | 7 exact, 5 result |
| R8 | Final | 1 match | **10 exact, 7 result** |

### Prediction Locks

Rounds 1, 2, and 3 all lock at the tournament kick-off on **June 11, 2026 at 23:00 UTC**. Knockout round locks are set per-round in `config.js`.

### Scoring Results (Rounds 1 & 2)

Rounds 1 and 2 require manual scoring (the "answers" aren't structured scores). After the tournament:
1. Go to **Admin → Scoring → Manual Override**
2. Set each player's R1 and R2 points manually
3. Click **Recalculate All Scores** to refresh totals

Rounds 3–8 score automatically when you enter match results.

### Live Scores

In **Admin → Match Results**, click **🔄 Fetch from API** to pull results from football-data.org. This requires a valid API key in `config.js`.

---

## 🛠️ Customisation

### Change Round Lock Times

Edit `ROUND_LOCKS` in `js/config.js`:
```javascript
ROUND_LOCKS: {
  round1: '2026-06-11T14:00:00Z', // your custom time
  ...
}
```

### Add/Remove Round 1 Questions

Edit `QUESTIONS` array in `pages/round1.html`. Each question has:
- `key` — unique identifier stored in DB
- `text` — question displayed to users
- `type` — `team-select`, `number`, `text`, `group-select`
- `pts` — scoring description shown to user

### Teams & Fixtures

The 48 teams and 72 group fixtures are in `js/data.js`. Update these once the official 2026 draw is confirmed (groups are approximate until the official draw, expected December 2025).

---

## 🔒 Security Notes

- **Never** commit your `config.js` with real API keys to a public repo
- Consider using GitHub Secrets + a build step to inject keys
- Or add `js/config.js` to `.gitignore` and distribute it separately
- Supabase RLS ensures users can only edit their own predictions
- Only admins can write match results and scores
- The Edge Function uses the service_role key server-side (never exposed to client)

---

## 🐛 Troubleshooting

**Sign-up not working**
- Check Supabase Auth settings: confirm email can be disabled for testing
- Ensure the invite code `KICKOFF` exists in your DB

**Scores not updating**
- Ensure realtime is enabled on the `scores` table in Supabase
- Check browser console for subscription errors

**Football API returning 403**
- Verify your API key in config.js
- The free tier has rate limits; use admin manual entry as backup

**GitHub Pages 404**
- Ensure all HTML files reference `../css/style.css` (not `/css/style.css`)
- Check your GitHub Pages source is set to the root of the `main` branch

---

## 📋 Quick Checklist

- [ ] Supabase project created
- [ ] `schema.sql` run in SQL Editor
- [ ] `config.js` filled with real keys
- [ ] Deployed to GitHub Pages
- [ ] Yourself set as admin (`set_admin_by_email`)
- [ ] Realtime enabled on `scores`, `match_results`, `predictions`
- [ ] Edge Function deployed (`supabase functions deploy recalculate-scores`)
- [ ] Invite codes generated and shared with friends
- [ ] Round lock times verified in `config.js`

---

## 🏆 Have fun — and may the best predictor win!

*Tournament kicks off June 11, 2026. Predictions lock at first kickoff.*
