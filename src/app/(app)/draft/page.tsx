import Link from 'next/link';

import { DraftBoard, type BoardFixture } from '@/components/DraftBoard';
import { OpenDraftButton } from '@/components/OpenDraftButton';
import { loadCrowdCounts, loadTeamForm } from '@/lib/ingest/form';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Picks' };

function Empty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-6">
      <h2 className="font-medium">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-grey-700">
        {children}
      </div>
    </div>
  );
}

export default async function DraftPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: season } = await supabase
    .from('seasons')
    .select('id')
    .eq('is_active', true)
    .maybeSingle();

  // Scoped to the active season: a player has a division per season, so
  // without this a returning player matches several rows.
  const [{ data: membership }, { data: profile }] = await Promise.all([
    supabase
      .from('division_members')
      .select('division_id, league_id, divisions(id, name, tier)')
      .eq('user_id', user!.id)
      .eq('season_id', season?.id ?? '00000000-0000-0000-0000-000000000000')
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user!.id)
      .single(),
  ]);

  const heading = (
    <div>
      <h1 className="display-lg">Picks</h1>
      <p className="mt-2 text-grey-700">
        Three fixtures a week. Once one&rsquo;s gone in your division, it&rsquo;s
        gone.
      </p>
    </div>
  );

  if (!membership) {
    return (
      <div className="flex flex-col gap-8">
        {heading}
        <Empty title="You're not in a division yet">
          Drafting happens inside a division, not across a whole league. Join or
          create a league on the{' '}
          <Link href="/leagues" className="underline underline-offset-4">
            leagues page
          </Link>
          , then the owner needs to arrange members into divisions.
        </Empty>
      </div>
    );
  }

  const division = membership.divisions;

  // The gameweek currently open for drafting, else the next one due.
  const nowIso = new Date().toISOString();
  const { data: openGameweek } = await supabase
    .from('gameweeks')
    .select('id, number, name, draft_opens_at, draft_closes_at, status')
    .lte('draft_opens_at', nowIso)
    .gt('draft_closes_at', nowIso)
    .order('number', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: nextGameweek } = openGameweek
    ? { data: null }
    : await supabase
        .from('gameweeks')
        .select('id, number, name, draft_opens_at, draft_closes_at, status')
        .gt('draft_opens_at', nowIso)
        .order('number', { ascending: true })
        .limit(1)
        .maybeSingle();

  const gameweek = openGameweek ?? nextGameweek;

  if (!gameweek) {
    return (
      <div className="flex flex-col gap-8">
        {heading}
        <Empty title="No gameweek scheduled">
          The season has no upcoming gameweeks. Run fixture ingestion, or check
          the season dates.
        </Empty>
      </div>
    );
  }

  const { data: draft } = await supabase
    .from('drafts')
    .select(
      'id, status, pick_order, picks_per_player, current_turn, turn_expires_at',
    )
    .eq('division_id', membership.division_id)
    .eq('gameweek_id', gameweek.id)
    .maybeSingle();

  const gameweekLabel = (
    <p className="text-sm text-grey-500">
      {division?.name} &middot; {gameweek.name ?? `Gameweek ${gameweek.number}`}{' '}
      &middot; closes{' '}
      {new Date(gameweek.draft_closes_at).toLocaleString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/London',
      })}
    </p>
  );

  if (!draft) {
    return (
      <div className="flex flex-col gap-8">
        {heading}
        {gameweekLabel}
        <Empty title="Picks aren’t open yet">
          <p>
            No draft has been opened for this gameweek. In a running season this
            happens automatically when the previous gameweek settles.
          </p>
          {profile?.is_admin && (
            <div className="mt-4">
              <OpenDraftButton gameweekId={gameweek.id} />
            </div>
          )}
        </Empty>
      </div>
    );
  }

  const [{ data: fixtureRows }, { data: picks }, { data: members }] =
    await Promise.all([
      supabase
        .from('fixtures')
        .select(
          `id, kickoff_at,
           home:teams!fixtures_home_team_id_fkey(id, name, short_name, crest_url, elo_rating),
           away:teams!fixtures_away_team_id_fkey(id, name, short_name, crest_url, elo_rating),
           competition:competitions(code, name, tier)`,
        )
        .eq('gameweek_id', gameweek.id)
        .eq('status', 'scheduled')
        .gt('kickoff_at', nowIso)
        .order('kickoff_at', { ascending: true }),
      supabase
        .from('picks')
        .select(
          'id, user_id, fixture_id, predicted_outcome, pick_number, is_auto_pick',
        )
        .eq('draft_id', draft.id),
      supabase
        .from('division_members')
        .select('user_id')
        .eq('division_id', membership.division_id),
    ]);

  const { data: players } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_color')
    .in(
      'id',
      (members ?? []).map((m) => m.user_id),
    );

  const [teamForm, crowd] = await Promise.all([
    loadTeamForm(supabase),
    loadCrowdCounts(supabase, gameweek.id),
  ]);

  // PostgREST types embedded relations as arrays when it can't prove a single
  // row; these are all to-one, so normalise before handing to the board.
  const fixtures: BoardFixture[] = (fixtureRows ?? [])
    .map((f) => {
    const row = f as unknown as {
      id: string;
      kickoff_at: string;
      home: BoardFixture['home'] | BoardFixture['home'][];
      away: BoardFixture['away'] | BoardFixture['away'][];
      competition:
        | BoardFixture['competition']
        | NonNullable<BoardFixture['competition']>[];
    };
    const one = <T,>(v: T | T[]): T => (Array.isArray(v) ? v[0] : v);
      const homeTeam = one(row.home);
      const awayTeam = one(row.away);
      return {
        id: row.id,
        kickoff_at: row.kickoff_at,
        home: { ...homeTeam, form: teamForm[homeTeam.id] ?? [] },
        away: { ...awayTeam, form: teamForm[awayTeam.id] ?? [] },
        competition: one(row.competition) ?? null,
      };
    })
    // Kickoff time first, then competition, then alphabetically.
    //
    // Competition order is by tier — Premier League, Championship, League One,
    // League Two — with cups last, since they have no tier. Sorting on the
    // competition *code* instead would put the EFL Cup between the Championship
    // and League One, which reads as arbitrary.
    .sort((a, b) => {
      const byTime =
        new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime();
      if (byTime !== 0) return byTime;

      const tierOf = (f: BoardFixture) => f.competition?.tier ?? 99;
      const byTier = tierOf(a) - tierOf(b);
      if (byTier !== 0) return byTier;

      return a.home.name.localeCompare(b.home.name);
    });

  // What other divisions in this league did with the same fixtures. Shown as
  // context, not folded into the model — see FixtureModel for why.
  const { data: siblingDivisions } = await supabase
    .from('divisions')
    .select('id, name')
    .eq('league_id', membership.league_id)
    .neq('id', membership.division_id);

  const siblingIds = (siblingDivisions ?? []).map((d) => d.id);
  const { data: siblingDrafts } = siblingIds.length
    ? await supabase
        .from('drafts')
        .select('id, division_id')
        .eq('gameweek_id', gameweek.id)
        .in('division_id', siblingIds)
    : { data: [] };

  const { data: siblingPicks } = siblingDrafts?.length
    ? await supabase
        .from('picks')
        .select('draft_id, fixture_id, predicted_outcome')
        .in(
          'draft_id',
          siblingDrafts.map((d) => d.id),
        )
    : { data: [] };

  const elsewhere: Record<string, { division: string; called: string }[]> = {};
  for (const pick of siblingPicks ?? []) {
    const divisionId = siblingDrafts?.find((d) => d.id === pick.draft_id)
      ?.division_id;
    const name = siblingDivisions?.find((d) => d.id === divisionId)?.name;
    const fixture = fixtures.find((f) => f.id === pick.fixture_id);
    if (!name || !fixture) continue;
    const called =
      pick.predicted_outcome === 'HOME'
        ? fixture.home.name
        : pick.predicted_outcome === 'AWAY'
          ? fixture.away.name
          : 'a draw';
    (elsewhere[pick.fixture_id] ??= []).push({ division: name, called });
  }

  return (
    <div className="flex flex-col gap-8">
      {heading}
      {gameweekLabel}
      <DraftBoard
        draft={draft}
        fixtures={fixtures}
        picks={picks ?? []}
        players={players ?? []}
        currentUserId={user!.id}
        elsewhere={elsewhere}
        crowd={crowd}
      />
    </div>
  );
}
