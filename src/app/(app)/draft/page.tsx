import Link from 'next/link';

import { DraftBoard, type BoardFixture } from '@/components/DraftBoard';
import { OpenDraftButton } from '@/components/OpenDraftButton';
import { Crest } from '@/components/Crest';
import { LockIcon } from '@/components/LockIcon';
import { SlipSet } from '@/components/SharePicks';
import { currentDraftFor } from '@/lib/current-draft';
import { SLIP_ACCENTS } from '@/lib/slip-accents';
import {
  loadCrowdCounts,
  loadTableRecords,
  loadTeamForm,
} from '@/lib/ingest/form';
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

export default async function DraftPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const { scope } = await searchParams;
  const wholeGroup = scope === 'group';
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
      .select('division_id, league_id, divisions(id, name, tier), leagues(name, owner_id)')
      .eq('user_id', user!.id)
      .eq('season_id', season?.id ?? '00000000-0000-0000-0000-000000000000')
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user!.id)
      .single(),
  ]);

  const one = <T,>(v: T | T[]): T => (Array.isArray(v) ? v[0] : v);
  const leagueRow = one(membership?.leagues);
  const isOwner = leagueRow?.owner_id === user!.id;

  const scopeToggle = membership ? (
    <div
      role="tablist"
      aria-label="Picks scope"
      className="mt-4 inline-flex rounded-lg border border-grey-300 bg-card p-0.5"
    >
      {[
        { key: 'division', label: one(membership.divisions)?.name ?? 'Your division' },
        { key: 'group', label: 'Whole group' },
      ].map((option) => {
        const active = (option.key === 'group') === wholeGroup;
        return (
          <Link
            key={option.key}
            href={option.key === 'group' ? '/draft?scope=group' : '/draft'}
            role="tab"
            aria-selected={active}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
              active ? 'bg-panel text-white' : 'text-grey-500 hover:text-ink'
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  ) : null;

  const heading = (
    <div>
      <h1 className="display-lg">Picks</h1>
      <p className="mt-2 text-grey-700">
        {wholeGroup
          ? `Every division in ${leagueRow?.name ?? 'your group'}, this gameweek.`
          : 'Three fixtures a week. Once one’s gone in your division, it’s gone.'}
      </p>
      {scopeToggle}
    </div>
  );

  if (!membership) {
    return (
      <div className="flex flex-col gap-8">
        {heading}
        <Empty title="You're not in a division yet">
          Drafting happens inside a division, not across a whole group. Join
          or create one on the{' '}
          <Link href="/leagues" className="underline underline-offset-4">
            group page
          </Link>
          , then the owner needs to arrange members into divisions.
        </Empty>
      </div>
    );
  }

  const division = membership.divisions;

  // Shared with the dashboard, so the two agree on what's running.
  const nowIso = new Date().toISOString();
  const { gameweek, draft } = await currentDraftFor(
    supabase,
    membership.division_id,
  );

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

  // ---- Whole group ----
  //
  // The board only means anything for your own division — those are the
  // rivals a fixture is taken from. Stepping back shows what every division
  // has taken this gameweek, which is also where the owner sends the slips
  // out from: it's the screen you're on once everybody has finished.
  if (wholeGroup) {
    const { data: divisions } = await supabase
      .from('divisions')
      .select('id, name, tier')
      .eq('league_id', membership.league_id)
      .eq('season_id', season?.id ?? '00000000-0000-0000-0000-000000000000')
      .order('tier');

    const { data: groupDrafts } = await supabase
      .from('drafts')
      .select('id, division_id, status')
      .eq('gameweek_id', gameweek.id)
      .in('division_id', (divisions ?? []).map((d) => d.id));

    const draftIds = (groupDrafts ?? []).map((d) => d.id);
    const { data: groupPicks } = draftIds.length
      ? await supabase
          .from('picks')
          .select(
            `draft_id, user_id, predicted_outcome, pick_number, points_awarded,
             fixtures(
               home_score, away_score,
               home:teams!fixtures_home_team_id_fkey(name, crest_url),
               away:teams!fixtures_away_team_id_fkey(name, crest_url)
             )`,
          )
          .in('draft_id', draftIds)
          .order('pick_number')
      : { data: [] };

    const { data: groupMembers } = await supabase
      .from('division_members')
      .select('user_id, division_id')
      .in('division_id', (divisions ?? []).map((d) => d.id));

    const { data: groupProfiles } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_color')
      .in(
        'id',
        (groupMembers ?? []).map((m) => m.user_id).length
          ? (groupMembers ?? []).map((m) => m.user_id)
          : ['00000000-0000-0000-0000-000000000000'],
      );
    const groupNameOf = (id: string) =>
      groupProfiles?.find((p) => p.id === id)?.display_name ?? 'Player';

    type GroupPickRow = {
      draft_id: string;
      user_id: string;
      predicted_outcome: 'HOME' | 'DRAW' | 'AWAY';
      points_awarded: number | null;
      fixtures: unknown;
    };

    const toPick = (row: GroupPickRow) => {
      const fixture = one(row.fixtures) as {
        home_score: number | null;
        away_score: number | null;
        home: { name: string; crest_url: string | null };
        away: { name: string; crest_url: string | null };
      };
      const home = one(fixture.home);
      const away = one(fixture.away);
      return {
        home: home.name,
        away: away.name,
        homeCrest: home.crest_url,
        awayCrest: away.crest_url,
        outcome: row.predicted_outcome,
        called:
          row.predicted_outcome === 'HOME'
            ? home.name
            : row.predicted_outcome === 'AWAY'
              ? away.name
              : 'Draw',
        homeScore: fixture.home_score,
        awayScore: fixture.away_score,
        points: row.points_awarded,
      };
    };

    const sections = (divisions ?? []).map((division, i) => {
      const ids = (groupDrafts ?? [])
        .filter((d) => d.division_id === division.id)
        .map((d) => d.id);
      const rows = ((groupPicks ?? []) as unknown as GroupPickRow[]).filter(
        (p) => ids.includes(p.draft_id),
      );
      const players = (groupMembers ?? [])
        .filter((m) => m.division_id === division.id)
        .map((m) => {
          const theirs = rows.filter((r) => r.user_id === m.user_id);
          const scored = theirs.some((r) => r.points_awarded !== null);
          return {
            player: groupNameOf(m.user_id),
            points: scored
              ? theirs.reduce((n, r) => n + (r.points_awarded ?? 0), 0)
              : null,
            picks: theirs.map(toPick),
          };
        });
      return {
        title: division.name,
        accent: SLIP_ACCENTS[i % SLIP_ACCENTS.length],
        groups: players,
        waiting: (groupDrafts ?? []).some(
          (d) => d.division_id === division.id && d.status !== 'complete',
        ),
      };
    });

    const anyPicks = sections.some((s) =>
      s.groups.some((g) => g.picks.length),
    );

    return (
      <div className="flex flex-col gap-8">
        {heading}
        <p className="text-sm text-grey-500">
          {gameweek.name ?? `Gameweek ${gameweek.number}`} &middot; closes{' '}
          {new Date(gameweek.draft_closes_at).toLocaleString('en-GB', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/London',
          })}
        </p>

        {!anyPicks ? (
          <Empty title="Nothing picked yet">
            No division has taken a fixture for this gameweek yet.
          </Empty>
        ) : (
          <>
            {sections.map((section) => (
              <section key={section.title} className="flex flex-col gap-3">
                <h2 className="label flex items-center gap-2 border-b border-grey-300 pb-2">
                  <span
                    aria-hidden
                    className="h-3 w-1 rounded-full"
                    style={{ background: section.accent }}
                  />
                  {section.title}
                  {section.waiting && (
                    <span className="font-normal normal-case tracking-normal text-grey-400">
                      still drafting
                    </span>
                  )}
                </h2>

                {section.groups.map((player) => (
                  <div key={player.player} className="card px-4 py-3">
                    <p className="mb-1.5 flex items-baseline justify-between gap-3">
                      <span className="font-medium">{player.player}</span>
                      {player.points !== null && (
                        <span className="numeric text-sm">
                          {player.points} pt{player.points === 1 ? '' : 's'}
                        </span>
                      )}
                    </p>
                    {player.picks.length === 0 ? (
                      <p className="text-sm text-grey-500">
                        Nothing picked yet.
                      </p>
                    ) : (
                      <ul className="flex flex-col divide-y divide-grey-100">
                        {player.picks.map((pick, index) => (
                          <li
                            key={index}
                            className="flex items-center gap-2 py-1.5 text-sm"
                          >
                            <Crest url={pick.homeCrest} className="h-4 w-4" />
                            <span className="min-w-0 truncate text-grey-700">
                              {pick.home}
                            </span>
                            <span className="text-grey-400">v</span>
                            <Crest url={pick.awayCrest} className="h-4 w-4" />
                            <span className="min-w-0 flex-1 truncate text-grey-700">
                              {pick.away}
                            </span>
                            <span
                              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                pick.outcome === 'HOME'
                                  ? 'bg-lime text-on-accent'
                                  : pick.outcome === 'AWAY'
                                    ? 'bg-away text-white'
                                    : 'bg-grey-300 text-on-accent'
                              }`}
                            >
                              {pick.called}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </section>
            ))}

            {/* The group's cards are the owner's to send. */}
            {isOwner && (
              <section>
                <h2 className="label mb-1 flex items-center gap-1.5">
                  <LockIcon className="h-3 w-3" />
                  Send the slips
                </h2>
                <p className="mb-1 text-sm text-grey-700">
                  One card per division for{' '}
                  {gameweek.name ?? `gameweek ${gameweek.number}`}.
                </p>
                <SlipSet
                  sections={sections.map(({ title, accent, groups }) => ({
                    title,
                    accent,
                    groups,
                  }))}
                  gameweek={`Gameweek ${gameweek.number}`}
                  subtitle={leagueRow?.name ?? 'Your group'}
                />
              </section>
            )}
          </>
        )}
      </div>
    );
  }

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

  const [teamForm, crowd, tables] = await Promise.all([
    loadTeamForm(supabase),
    loadCrowdCounts(supabase, gameweek.id),
    loadTableRecords(
      supabase,
      season?.id ?? '00000000-0000-0000-0000-000000000000',
    ),
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
        home: {
          ...homeTeam,
          form: teamForm[homeTeam.id] ?? [],
          table: tables[homeTeam.id] ?? null,
        },
        away: {
          ...awayTeam,
          form: teamForm[awayTeam.id] ?? [],
          table: tables[awayTeam.id] ?? null,
        },
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
        gameweekLabel={gameweek.name ?? `Gameweek ${gameweek.number}`}
        divisionName={division?.name ?? 'Your division'}
      />
    </div>
  );
}
