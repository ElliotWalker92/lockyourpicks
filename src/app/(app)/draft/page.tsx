import Link from 'next/link';

import { DraftBoard, type BoardFixture } from '@/components/DraftBoard';
import { OpenDraftButton } from '@/components/OpenDraftButton';
import { FixtureLine, OutcomeChip } from '@/components/Fixture';
import { LiveScores } from '@/components/LiveScores';
import { tallyOf, verdictOf } from '@/lib/scoring';
import { LockIcon } from '@/components/LockIcon';
import { RoundStrip } from '@/components/RoundStrip';
import { SlipWaiting } from '@/components/SlipWaiting';
import { turnDeadlines } from '@/lib/turn-windows';
import { SlipSet } from '@/components/SharePicks';
import { currentDraftFor } from '@/lib/current-draft';
import { loadRounds } from '@/lib/rounds';
import { SLIP_ACCENTS } from '@/lib/slip-accents';
import {
  loadCrowdCounts,
  loadTableRecords,
  loadTeamForm,
} from '@/lib/ingest/form';
import { createClient } from '@/lib/supabase/server';
import { activeLeagueId } from '@/lib/active-league';
import { viewingFor } from '@/lib/viewing';

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
  const [view, { data: profile }] = await Promise.all([
    viewingFor(
      supabase,
      user!.id,
      season?.id ?? '00000000-0000-0000-0000-000000000000',
      await activeLeagueId(),
    ),
    supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user!.id)
      .single(),
  ]);

  const one = <T,>(v: T | T[]): T => (Array.isArray(v) ? v[0] : v);
  const isOwner = view?.isOwner ?? false;

  // A viewer has no division to draft in, so the whole group is the only
  // view that means anything to them — and it's read-only for everyone.
  const wholeGroupOnly = view?.viewer ?? false;

  const scopeToggle = view && !wholeGroupOnly ? (
    <div
      role="tablist"
      aria-label="Picks scope"
      className="mt-4 inline-flex rounded-lg border border-grey-300 bg-card p-0.5"
    >
      {[
        { key: 'division', label: view?.divisionName ?? 'Your division' },
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

  // Takes the round strip, which can't be built until we know what gameweek
  // is live — and the empty states below render before we do.
  const heading = (strip?: React.ReactNode) => (
    <div>
      <h1 className="display-lg">Picks</h1>
      <p className="mt-2 text-grey-700">
        {wholeGroup
          ? `Every division in ${view?.leagueName ?? 'your group'}, this gameweek.`
          : 'Three fixtures a round. Once one’s gone in your division, it’s gone.'}
      </p>
      {scopeToggle}
      {strip && <div className="mt-4">{strip}</div>}
    </div>
  );

  if (!view) {
    return (
      <div className="flex flex-col gap-8">
        {heading()}
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

  // Shared with the dashboard, so the two agree on what's running. A viewer
  // has no division, so any division in the group anchors the same answer.
  const nowIso = new Date().toISOString();
  const { gameweek, draft } = await currentDraftFor(
    supabase,
    view.anchorDivisionId,
  );

  const rounds = await loadRounds(supabase, [view.anchorDivisionId]);
  const roundStrip = (
    <RoundStrip
      rounds={rounds}
      live={gameweek?.number ?? null}
      selected="live"
      scope={wholeGroup || wholeGroupOnly ? 'group' : 'division'}
    />
  );

  if (!gameweek) {
    return (
      <div className="flex flex-col gap-8">
        {heading(roundStrip)}
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
  if (wholeGroup || wholeGroupOnly) {
    const { data: divisions } = await supabase
      .from('divisions')
      .select('id, name, tier')
      .eq('league_id', view.leagueId)
      .eq('season_id', season?.id ?? '00000000-0000-0000-0000-000000000000')
      .order('tier');

    const { data: groupDrafts } = await supabase
      .from('drafts')
      // The running order and the clock come too: a watcher's slip says who
      // each division is waiting on and when the seats behind them are due.
      .select(
        'id, division_id, status, pick_order, current_turn, turn_expires_at',
      )
      .eq('gameweek_id', gameweek.id)
      .in('division_id', (divisions ?? []).map((d) => d.id));

    const draftIds = (groupDrafts ?? []).map((d) => d.id);
    const { data: groupPicks } = draftIds.length
      ? await supabase
          .from('picks')
          .select(
            `draft_id, user_id, predicted_outcome, pick_number, points_awarded,
             fixtures(
               home_score, away_score, result, status,
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
        result: 'HOME' | 'DRAW' | 'AWAY' | null;
        status: string;
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
        result: fixture.result,
        status: fixture.status,
        points: row.points_awarded,
      };
    };

    const hardDeadline = new Date(
      new Date(gameweek.draft_closes_at).getTime() - 5 * 60_000,
    );
    const rightNow = new Date();

    const sections = (divisions ?? []).map((division, i) => {
      const theDraft = (groupDrafts ?? []).find(
        (d) => d.division_id === division.id,
      );
      const ids = (groupDrafts ?? [])
        .filter((d) => d.division_id === division.id)
        .map((d) => d.id);
      const rows = ((groupPicks ?? []) as unknown as GroupPickRow[]).filter(
        (p) => ids.includes(p.draft_id),
      );

      // When each seat still to pick is due — the real expiry for whoever is
      // on the clock, a projection for the seats behind them.
      const order: string[] = theDraft?.pick_order ?? [];
      const due =
        theDraft && theDraft.status !== 'complete' && order.length
          ? turnDeadlines({
              seats: order.length,
              currentTurn: theDraft.current_turn ?? 0,
              currentExpiry: theDraft.turn_expires_at
                ? new Date(theDraft.turn_expires_at)
                : null,
              hardDeadline,
              now: rightNow,
            })
          : [];

      const players = (groupMembers ?? [])
        .filter((m) => m.division_id === division.id)
        .map((m) => {
          const theirs = rows.filter((r) => r.user_id === m.user_id);
          const picks = theirs.map(toPick);
          const tally = tallyOf(
            picks.map((pick) => ({
              predicted_outcome: pick.outcome,
              points_awarded: pick.points,
              result: pick.result,
            })),
          );
          const seat = order.indexOf(m.user_id);
          const mine = seat >= 0 ? due[seat] : null;
          return {
            player: groupNameOf(m.user_id),
            points: tally.decided > 0 ? tally.landed : null,
            provisional: tally.decided > 0 && !tally.settled,
            decided: tally.decided,
            picks,
            // How many turns have to finish before this one starts, so a
            // waiting player can be told what they're waiting on rather
            // than only that they haven't picked.
            ahead:
              seat >= 0 && theDraft && theDraft.status !== 'complete'
                ? Math.max(seat - (theDraft.current_turn ?? 0), 0)
                : null,
            dueAt: mine ? mine.at.toISOString() : null,
            projected: mine ? mine.projected : false,
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
        <LiveScores gameweekId={gameweek.id} />
        {heading(roundStrip)}
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
              <section
                key={section.title}
                // A viewer never sees the board, so this read-only slip is
                // the only thing the tour can point at on this page.
                data-tour="slip"
                className="flex flex-col gap-3"
              >
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
                        <span className="flex items-baseline gap-1.5">
                          <span className="numeric text-sm">
                            {player.points}
                          </span>
                          <span className="text-xs text-grey-500">
                            {player.provisional
                              ? `from ${player.decided}`
                              : `pt${player.points === 1 ? '' : 's'}`}
                          </span>
                        </span>
                      )}
                    </p>
                    {player.picks.length === 0 ? (
                      <SlipWaiting
                        ahead={player.ahead}
                        dueAt={player.dueAt}
                        projected={player.projected}
                      />
                    ) : (
                      <ul className="flex flex-col divide-y divide-grey-100">
                        {player.picks.map((pick, index) => {
                          const verdict = verdictOf({
                            predicted_outcome: pick.outcome,
                            points_awarded: pick.points,
                            result: pick.result,
                          });
                          return (
                            <li
                              key={index}
                              className="flex items-center gap-2 py-1.5 text-sm"
                            >
                              <FixtureLine
                                home={pick.home}
                                away={pick.away}
                                homeCrest={pick.homeCrest}
                                awayCrest={pick.awayCrest}
                                outcome={pick.outcome}
                                className="flex-1 text-grey-700"
                              />
                              {pick.homeScore !== null && (
                                <span
                                  className={`shrink-0 font-mono text-xs tabular-nums ${
                                    pick.status === 'live'
                                      ? 'font-semibold text-hot'
                                      : 'text-grey-500'
                                  }`}
                                >
                                  {pick.homeScore}&ndash;{pick.awayScore}
                                </span>
                              )}
                              <OutcomeChip outcome={pick.outcome} />
                              {verdict.decided && (
                                <span
                                  className={`w-4 shrink-0 text-right font-medium ${
                                    verdict.correct ? 'text-win' : 'text-loss'
                                  }`}
                                  title={verdict.correct ? 'Correct' : 'Wrong'}
                                >
                                  {verdict.correct ? '✓' : '✕'}
                                </span>
                              )}
                            </li>
                          );
                        })}
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
                  subtitle={view.leagueName}
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
      {view.divisionName} &middot; {gameweek.name ?? `Gameweek ${gameweek.number}`}{' '}
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
        {heading(roundStrip)}
        {gameweekLabel}
        <Empty title="Picks aren’t open yet">
          <p>
            {view.paused
              ? `${view.leagueName} is still picking outside the app this round. Your earlier weeks are all in the tables here — drafting opens in the app once the switch is made.`
              : 'No draft has been opened for this gameweek. In a running season this happens automatically when the previous gameweek settles.'}
          </p>
          {profile?.is_admin && !view.paused && (
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
      // Every fixture in the gameweek, not just the pickable ones.
      //
      // This used to filter to `scheduled` with a kickoff still ahead, which
      // is right for the board — you can't take a match that has started —
      // and quite wrong for the slip, which looks its picks up in this same
      // list. The moment a match kicked off its fixture left the result set,
      // the lookup returned undefined, and the pick rendered as nothing: your
      // own slip quietly lost a row exactly when it got interesting, while
      // the counter above it still said 3/3.
      //
      // The board now narrows this list itself instead.
      supabase
        .from('fixtures')
        .select(
          `id, kickoff_at, status, home_score, away_score, result,
           home:teams!fixtures_home_team_id_fkey(id, name, crest_url, elo_rating),
           away:teams!fixtures_away_team_id_fkey(id, name, crest_url, elo_rating),
           competition:competitions(code, name, tier)`,
        )
        .eq('gameweek_id', gameweek.id)
        .order('kickoff_at', { ascending: true }),
      supabase
        .from('picks')
        .select(
          'id, user_id, fixture_id, predicted_outcome, pick_number, is_auto_pick, points_awarded',
        )
        .eq('draft_id', draft.id),
      supabase
        .from('division_members')
        .select('user_id')
        .eq('division_id', view.divisionId!),
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
      status: BoardFixture['status'];
      home_score: number | null;
      away_score: number | null;
      result: BoardFixture['result'];
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
        status: row.status,
        home_score: row.home_score,
        away_score: row.away_score,
        result: row.result,
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
    .eq('league_id', view.leagueId)
    .neq('id', view.divisionId!);

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
      {/* Scores and ticks reach the slip without a reload — see 0021. */}
      <LiveScores gameweekId={gameweek.id} />
      {heading(roundStrip)}
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
        divisionName={view.divisionName ?? 'Your division'}
        // Five minutes before the first kickoff — draft_hard_deadline in
        // migration 0015, mirrored so the board can say when a seat is due.
        hardDeadline={new Date(
          new Date(gameweek.draft_closes_at).getTime() - 5 * 60_000,
        ).toISOString()}
        now={nowIso}
      />
    </div>
  );
}
