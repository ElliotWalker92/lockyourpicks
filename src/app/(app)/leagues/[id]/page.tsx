import { notFound } from 'next/navigation';

import { ArrangeDivisions } from '@/components/ArrangeDivisions';
import { DivisionEditor } from '@/components/DivisionEditor';
import { OpenNextGameweek } from '@/components/OpenNextGameweek';
import { SharePicks, type SlipGroup } from '@/components/SharePicks';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'League' };

export default async function LeaguePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: league } = await supabase
    .from('leagues')
    .select('id, name, join_code, owner_id, division_size')
    .eq('id', id)
    .maybeSingle();

  if (!league) notFound();

  const { data: season } = await supabase
    .from('seasons')
    .select('id')
    .eq('is_active', true)
    .maybeSingle();

  const seasonId = season?.id ?? '00000000-0000-0000-0000-000000000000';

  const [{ data: members }, { data: divisions }, { data: divisionMembers }] =
    await Promise.all([
      supabase
        .from('league_members')
        .select('user_id, joined_at')
        .eq('league_id', id)
        .order('joined_at', { ascending: true }),
      // The active season's arrangement, not every season's.
      supabase
        .from('divisions')
        .select('id, name, tier')
        .eq('league_id', id)
        .eq('season_id', seasonId)
        .order('tier', { ascending: true }),
      supabase
        .from('division_members')
        .select('division_id, user_id, seat')
        .eq('league_id', id)
        .eq('season_id', seasonId)
        .order('seat', { ascending: true }),
    ]);

  const userIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_color, avatar_url')
    .in('id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);

  const nameOf = (userId: string) =>
    profiles?.find((p) => p.id === userId)?.display_name ?? 'Player';
  const colourOf = (userId: string) =>
    profiles?.find((p) => p.id === userId)?.avatar_color ?? '#c8f135';

  const isOwner = league.owner_id === user!.id;

  // ---- Every division's picks for the latest round, on one card ----
  //
  // The owner is usually the one running the group chat, so they're the one
  // who wants the whole thing rather than just their own three. Built here
  // and not on the picks page because only the owner can see across every
  // division at once.
  const one = <T,>(v: T | T[]): T => (Array.isArray(v) ? v[0] : v);
  const wholeSlip: SlipGroup[] = [];
  let slipGameweek: number | null = null;

  if (isOwner && divisions?.length) {
    const { data: leagueDrafts } = await supabase
      .from('drafts')
      .select('id, division_id, gameweek_id, gameweeks(number)')
      .in(
        'division_id',
        divisions.map((d) => d.id),
      );

    const rounds = new Map<string, { number: number; drafts: typeof leagueDrafts }>();
    for (const d of leagueDrafts ?? []) {
      const gw = one(d.gameweeks) as { number: number } | null;
      const entry = rounds.get(d.gameweek_id) ?? {
        number: gw?.number ?? 0,
        drafts: [] as typeof leagueDrafts,
      };
      entry.drafts!.push(d);
      rounds.set(d.gameweek_id, entry);
    }

    for (const round of [...rounds.values()].sort((a, b) => b.number - a.number)) {
      const draftIds = (round.drafts ?? []).map((d) => d.id);
      const { data: picks } = await supabase
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
        .order('pick_number');

      if (!picks?.length) continue;

      for (const division of divisions) {
        const ids = (round.drafts ?? [])
          .filter((d) => d.division_id === division.id)
          .map((d) => d.id);
        const inDivision = picks.filter((p) => ids.includes(p.draft_id));
        if (!inDivision.length) continue;

        const players = [...new Set(inDivision.map((p) => p.user_id))];
        for (const playerId of players) {
          const theirs = inDivision.filter((p) => p.user_id === playerId);
          const scored = theirs.some((p) => p.points_awarded !== null);
          wholeSlip.push({
            section: division.name,
            player: nameOf(playerId),
            points: scored
              ? theirs.reduce((n, p) => n + (p.points_awarded ?? 0), 0)
              : null,
            picks: theirs.map((p) => {
              const fixture = one(p.fixtures) as {
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
                outcome: p.predicted_outcome,
                called:
                  p.predicted_outcome === 'HOME'
                    ? home.name
                    : p.predicted_outcome === 'AWAY'
                      ? away.name
                      : 'Draw',
                homeScore: fixture.home_score,
                awayScore: fixture.away_score,
                points: p.points_awarded,
              };
            }),
          });
        }
      }

      slipGameweek = round.number;
      break;
    }
  }
  const unassigned = (members ?? []).filter(
    (m) => !divisionMembers?.some((dm) => dm.user_id === m.user_id),
  );

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="display-lg">{league.name}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-grey-700">
          <span>
            {members?.length ?? 0} player
            {(members?.length ?? 0) === 1 ? '' : 's'}
          </span>
          <span aria-hidden>·</span>
          <span>{league.division_size} per division</span>
          <span aria-hidden>·</span>
          <span>
            Join code{' '}
            <span className="font-mono tracking-widest text-ink">
              {league.join_code}
            </span>
          </span>
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="label">
          Divisions
        </h2>

        {divisions?.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {divisions.map((division) => {
              const roster = (divisionMembers ?? []).filter(
                (dm) => dm.division_id === division.id,
              );
              return (
                <div
                  key={division.id}
                  className="card p-4"
                >
                  <h3 className="mb-3 font-medium">{division.name}</h3>
                  <ul className="flex flex-col gap-2">
                    {roster.map((dm) => (
                      <li
                        key={dm.user_id}
                        className="flex items-center gap-2.5 text-sm"
                      >
                        <span
                          aria-hidden
                          className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-on-accent"
                          style={{ background: colourOf(dm.user_id) }}
                        >
                          {nameOf(dm.user_id).charAt(0).toUpperCase()}
                        </span>
                        {nameOf(dm.user_id)}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-grey-500">
            No divisions yet. Nobody can draft until players are split into
            them — drafting happens inside a division, not across the league.
          </p>
        )}

        {unassigned.length > 0 && divisions?.length ? (
          <p className="text-sm text-loss">
            {unassigned.length} player
            {unassigned.length === 1 ? '' : 's'} joined after the divisions were
            arranged and {unassigned.length === 1 ? 'is' : 'are'} not in one
            yet.
          </p>
        ) : null}

        {isOwner && !divisions?.length && (
          <div className="pt-2">
            <ArrangeDivisions leagueId={league.id} hasDivisions={false} />
          </div>
        )}
      </section>

      {isOwner && !!divisions?.length && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="label">Arrange divisions</h2>
            <p className="mt-1 text-sm text-grey-700">
              Rename them, move players between them, and set who picks first.
            </p>
          </div>
          <DivisionEditor
            leagueId={league.id}
            players={(members ?? []).map((m) => {
              const p = profiles?.find((x) => x.id === m.user_id);
              return {
                id: m.user_id,
                name: p?.display_name ?? 'Player',
                colour: p?.avatar_color ?? '#c8f135',
                avatarUrl: p?.avatar_url ?? null,
              };
            })}
            initial={(divisions ?? []).map((d) => ({
              id: d.id,
              name: d.name,
              tier: d.tier,
              members: (divisionMembers ?? [])
                .filter((dm) => dm.division_id === d.id)
                .map((dm) => dm.user_id),
            }))}
          />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="label">
          All players
        </h2>
        <ul className="flex flex-col gap-2">
          {(members ?? []).map((m) => (
            <li key={m.user_id} className="flex items-center gap-2.5 text-sm">
              <span
                aria-hidden
                className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-on-accent"
                style={{ background: colourOf(m.user_id) }}
              >
                {nameOf(m.user_id).charAt(0).toUpperCase()}
              </span>
              <span className="flex-1">{nameOf(m.user_id)}</span>
              {m.user_id === league.owner_id && (
                <span className="text-xs text-grey-500">Owner</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isOwner && (
        <section className="card p-5">
          <h2 className="display-md">Running the group</h2>
          <p className="mt-1 text-sm text-grey-700">
            Only you can see this.
          </p>

          <div className="mt-4 border-t border-grey-300 pt-4">
            <OpenNextGameweek leagueId={league.id} />
          </div>

          {wholeSlip.length > 0 && (
            <div className="mt-2">
              <SharePicks
                groups={wholeSlip}
                gameweek={`Gameweek ${slipGameweek}`}
                subtitle={league.name}
                locked
                heading="Send every division's slip"
                note={`Every pick in ${league.name} for gameweek ${slipGameweek}, division by division, on one card.`}
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
