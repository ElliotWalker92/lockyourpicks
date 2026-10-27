import Link from 'next/link';

import { LiveScores } from '@/components/LiveScores';
import { LockIcon } from '@/components/LockIcon';
import { RoundStrip } from '@/components/RoundStrip';
import { Slip, type SlipPick, type SlipPlayer } from '@/components/Slip';
import { tallyOf } from '@/lib/scoring';
import { SLIP_ACCENTS } from '@/lib/slip-accents';
import {
  SharePicks,
  SlipSet,
  type SlipGroup,
  type SlipSection,
} from '@/components/SharePicks';
import { currentDraftFor } from '@/lib/current-draft';
import { loadRounds } from '@/lib/rounds';
import { createClient } from '@/lib/supabase/server';
import { activeLeagueId } from '@/lib/active-league';
import { viewingFor } from '@/lib/viewing';

export const metadata = { title: 'Picks' };

const NOBODY = '00000000-0000-0000-0000-000000000000';

type TeamRow = { name: string; crest_url: string | null };
type Team = TeamRow | TeamRow[];
const one = <T,>(v: T | T[]): T => (Array.isArray(v) ? v[0] : v);

/**
 * Past gameweeks: who picked what, and how it went.
 *
 * The spreadsheet showed every player's three picks side by side each week,
 * and that was most of the point — you want to see what everyone called, not
 * just the total it produced. Once a gameweek settled here the picks
 * disappeared from the interface entirely.
 *
 * This is the Picks tab a week later, not a destination of its own — the
 * round strip is the only way in, and the live round sits on the same strip.
 * It keeps its own route because it's a different screen: a table you read
 * rather than a board you act on.
 *
 * Shows your own division. Other divisions draft from the same slate but
 * against different rivals, so mixing them together would compare picks that
 * were never in competition.
 */
export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ gw?: string; scope?: string }>;
}) {
  const { gw, scope } = await searchParams;
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
  const seasonId = season?.id ?? NOBODY;

  const view = await viewingFor(
    supabase,
    user!.id,
    seasonId,
    await activeLeagueId(),
  );

  // Watching rather than playing: there is no "your division" to narrow to.
  const wholeGroupOnly = view?.viewer ?? false;
  const isOwner = view?.isOwner ?? false;

  // Which divisions are in view. Your own by default: picks are drafted
  // against your division-mates, so those are the ones your week was
  // actually competing with. The whole group is a step back from that.
  const { data: groupDivisions } = view
    ? await supabase
        .from('divisions')
        .select('id, name, tier')
        .eq('league_id', view.leagueId)
        .eq('season_id', seasonId)
        .order('tier')
    : { data: [] };

  const divisionsInView = wholeGroup || wholeGroupOnly
    ? (groupDivisions ?? [])
    : (groupDivisions ?? []).filter((d) => d.id === view?.divisionId);

  const scopeToggle = view && !wholeGroupOnly ? (
    <div
      role="tablist"
      aria-label="Results scope"
      className="mt-4 inline-flex rounded-lg border border-grey-300 bg-card p-0.5"
    >
      {[
        { key: 'division', label: view.divisionName ?? 'Your division' },
        { key: 'group', label: 'Whole group' },
      ].map((option) => {
        const active = (option.key === 'group') === wholeGroup;
        return (
          <Link
            key={option.key}
            href={
              option.key === 'group'
                ? `/results?scope=group${gw ? `&gw=${gw}` : ''}`
                : `/results${gw ? `?gw=${gw}` : ''}`
            }
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

  const heading = (strip?: React.ReactNode) => (
    <div>
      <p className="label">
        {wholeGroup || wholeGroupOnly
          ? (view?.leagueName ?? 'Picks')
          : (view?.divisionName ?? 'Picks')}
      </p>
      <h1 className="display-lg mt-1">Picks</h1>
      {scopeToggle}
      {strip && <div className="mt-4">{strip}</div>}
    </div>
  );

  if (!view) {
    return (
      <div className="flex flex-col gap-8">
        {heading()}
        <div className="card p-6">
          <h2 className="display-md">Nothing to show yet</h2>
          <p className="mt-2 text-grey-700">
            You&rsquo;re not in a division, so there are no past picks. Start on
            the{' '}
            <Link href="/leagues" className="underline underline-offset-4">
              leagues page
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  // Gameweeks the divisions in view have actually drafted, and the one being
  // drafted right now — which is a chip on the same strip, back on /draft.
  const [played, { gameweek: live }] = await Promise.all([
    loadRounds(
      supabase,
      divisionsInView.map((d) => d.id),
    ),
    currentDraftFor(supabase, view.anchorDivisionId),
  ]);

  const selected =
    played.find((p) => String(p.number) === gw) ?? played[0];

  const strip = (
    <RoundStrip
      rounds={played}
      live={live?.number ?? null}
      selected={selected?.number ?? 'live'}
      scope={wholeGroup || wholeGroupOnly ? 'group' : 'division'}
    />
  );

  if (!selected) {
    return (
      <div className="flex flex-col gap-8">
        {heading(strip)}
        <div className="card p-6">
          <h2 className="display-md">No gameweeks drafted yet</h2>
          <p className="mt-2 text-grey-700">
            Once your division has drafted a gameweek, every pick shows up here.
          </p>
        </div>
      </div>
    );
  }

  const [{ data: picks }, { data: members }] = await Promise.all([
    supabase
      .from('picks')
      .select(
        `id, user_id, predicted_outcome, is_auto_pick, points_awarded, pick_number,
         fixtures(
           kickoff_at, home_score, away_score, result, status,
           home:teams!fixtures_home_team_id_fkey(name, crest_url),
           away:teams!fixtures_away_team_id_fkey(name, crest_url),
           competition:competitions(code)
         )`,
      )
      .in('draft_id', selected.draftIds)
      .order('pick_number'),
    supabase
      .from('division_members')
      .select('user_id, division_id')
      .in('division_id', divisionsInView.map((d) => d.id)),
  ]);

  const memberIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_color, avatar_url')
    .in('id', memberIds.length ? memberIds : [NOBODY]);

  const profileOf = (id: string) => profiles?.find((p) => p.id === id);
  const nameOf = (id: string) => profileOf(id)?.display_name ?? 'Player';

  type Row = {
    id: string;
    user_id: string;
    predicted_outcome: 'HOME' | 'DRAW' | 'AWAY';
    is_auto_pick: boolean;
    points_awarded: number | null;
    fixtures: {
      kickoff_at: string;
      home_score: number | null;
      away_score: number | null;
      result: 'HOME' | 'DRAW' | 'AWAY' | null;
      status: string;
      home: Team;
      away: Team;
      competition: { code: string } | { code: string }[] | null;
    };
  };

  const rows = (picks ?? []) as unknown as Row[];
  const divisionOf = new Map(
    (members ?? []).map((m) => [m.user_id, m.division_id]),
  );
  const divisionName = new Map(divisionsInView.map((d) => [d.id, d.name]));

  const byPlayer = memberIds.map((id) => ({
    id,
    divisionId: divisionOf.get(id) ?? '',
    picks: rows.filter((r) => r.user_id === id),
    points: rows
      .filter((r) => r.user_id === id)
      .reduce((sum, r) => sum + (r.points_awarded ?? 0), 0),
  }));
  byPlayer.sort((a, b) => b.points - a.points);

  // Grouped by division when the whole group is in view, so a run of nine
  // names isn't presented as one table it never competed in.
  const sections = wholeGroup || wholeGroupOnly
    ? divisionsInView.map((d) => ({
        id: d.id,
        name: d.name,
        players: byPlayer.filter((p) => p.divisionId === d.id),
      }))
    : [
        {
          id: view.divisionId!,
          name: divisionName.get(view.divisionId!) ?? '',
          players: byPlayer,
        },
      ];

  const anyScored = rows.some((r) => r.points_awarded !== null);

  // The same slip as the draft board's, but carrying how it's actually going.
  // Sharing three picks on Tuesday and never saying how they finished is half
  // a conversation; this is the other half, and it works mid-gameweek because
  // a fixture that has a score has one whether or not the week has settled.
  const slip: SlipGroup[] = byPlayer.map((player) => ({
    player: nameOf(player.id),
    points: anyScored ? player.points : null,
    picks: player.picks.map((r) => {
      const home = one(r.fixtures.home);
      const away = one(r.fixtures.away);
      return {
        home: home.name,
        away: away.name,
        homeCrest: home.crest_url,
        awayCrest: away.crest_url,
        outcome: r.predicted_outcome,
        called:
          r.predicted_outcome === 'HOME'
            ? home.name
            : r.predicted_outcome === 'AWAY'
              ? away.name
              : 'Draw',
        homeScore: r.fixtures.home_score,
        awayScore: r.fixtures.away_score,
        result: r.fixtures.result,
        points: r.points_awarded,
      };
    }),
  }));

  // One slip per division, each with its own colour.
  const slipSections: SlipSection[] = divisionsInView.map((division, i) => ({
    title: division.name,
    accent: SLIP_ACCENTS[i % SLIP_ACCENTS.length],
    groups: slip.filter(
      (_, index) => byPlayer[index]?.divisionId === division.id,
    ),
  }));

  const finished = rows.every(
    (r) => r.fixtures.status === 'finished' || r.points_awarded !== null,
  );
  const kickedOff = rows.some((r) => r.fixtures.home_score !== null);

  return (
    <div className="flex flex-col gap-8">
      {/* Scores and points land here without a reload — see 0021. */}
      <LiveScores gameweekId={selected.gameweekId} />
      {heading(strip)}

      {!anyScored && (
        <p className="card px-4 py-3 text-sm text-grey-700">
          Gameweek {selected.number} hasn&rsquo;t been scored yet &mdash; picks
          are shown, points land once the matches finish.
        </p>
      )}

      {/* ---- Each player's card, under its division when the whole group
              is in view ---- */}
      <div className="flex flex-col gap-8">
        {sections.map((section) => (
          <div key={section.id} className="flex flex-col gap-5">
            {wholeGroup && (
              <h2 className="label border-b border-grey-300 pb-2">
                {section.name}
              </h2>
            )}
            {section.players.length === 0 ? (
              <p className="text-sm text-grey-500">
                No picks from this division for gameweek {selected.number}.
              </p>
            ) : (
              /* The same component the board and the whole-group view use.
                 This page used to draw its own: a card per player with its
                 own avatar size, its own points treatment and an outcome
                 chip the board had already dropped. `prominent` is the one
                 thing it still asks for — a round that is over is read for
                 its score, so the figure is set bigger. */
              <Slip
                prominent
                players={section.players.map((player): SlipPlayer => {
                  const profile = profileOf(player.id);
                  return {
                    key: player.id,
                    name: nameOf(player.id),
                    colour: profile?.avatar_color ?? '#c8f135',
                    avatarUrl: profile?.avatar_url ?? null,
                    mine: player.id === user!.id,
                    // tallyOf rather than a plain sum of `points_awarded`,
                    // which is null until the whole gameweek settles — so a
                    // correct call sat on screen reading zero all Saturday
                    // while the board, three taps away, already said "1
                    // from 1". One rule, from one place.
                    tally: tallyOf(
                      player.picks.map((r) => ({
                        predicted_outcome: r.predicted_outcome,
                        points_awarded: r.points_awarded,
                        result: r.fixtures.result,
                      })),
                    ),
                    picks: player.picks.map((row): SlipPick => {
                      const homeTeam = one(row.fixtures.home);
                      const awayTeam = one(row.fixtures.away);
                      return {
                        key: row.id,
                        home: homeTeam.name,
                        away: awayTeam.name,
                        homeCrest: homeTeam.crest_url,
                        awayCrest: awayTeam.crest_url,
                        outcome: row.predicted_outcome,
                        homeScore: row.fixtures.home_score,
                        awayScore: row.fixtures.away_score,
                        result: row.fixtures.result,
                        status: row.fixtures.status,
                        points: row.points_awarded,
                        isAuto: row.is_auto_pick,
                        // This list isn't grouped by competition the way
                        // the board is, so the row has to say which one
                        // it was.
                        competition: row.fixtures.competition
                          ? one(row.fixtures.competition).code
                          : null,
                      };
                    }),
                  };
                })}
              />
            )}
          </div>
        ))}
      </div>

      {/* The whole group's card is the owner's to send — it's the one that
          goes in the group chat, and it covers divisions the reader isn't in.
          Your own division's slip is anyone's. */}
      {rows.length > 0 && (!(wholeGroup || wholeGroupOnly) || isOwner) && (
        <section>
          <h2 className="label mb-1 flex items-center gap-1.5">
            <LockIcon className="h-3 w-3" />
            {finished ? 'How it finished' : kickedOff ? 'How it stands' : 'The slip'}
          </h2>
          <p className="mb-1 text-sm text-grey-700">
            {wholeGroup || wholeGroupOnly
              ? `Every pick in ${view.leagueName} for gameweek ${selected.number} — one card per division.`
              : finished
                ? `All ${rows.length} picks from gameweek ${selected.number}, with the results and what they scored.`
                : kickedOff
                  ? `All ${rows.length} picks with the scores as they stand right now.`
                  : `All ${rows.length} picks from gameweek ${selected.number}.`}
          </p>
          {wholeGroup || wholeGroupOnly ? (
            <SlipSet
              sections={slipSections}
              gameweek={`Gameweek ${selected.number}`}
              subtitle={view.leagueName}
            />
          ) : (
            <SharePicks
              groups={slip}
              gameweek={`Gameweek ${selected.number}`}
              subtitle={view.divisionName ?? 'Your division'}
              locked
              heading={finished ? 'Send the final slip' : 'Send the slip'}
            />
          )}
        </section>
      )}
    </div>
  );
}
