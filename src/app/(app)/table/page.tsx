import Link from 'next/link';

import { TableScopeToggle } from '@/components/TableScopeToggle';
import { Crest } from '@/components/Crest';
import { rank, type StandingRow } from '@/lib/standings';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Table' };

const PALETTE = [
  '#c8f135',
  '#7dd3fc',
  '#fca5a5',
  '#fcd34d',
  '#c4b5fd',
  '#86efac',
  '#f9a8d4',
  '#fdba74',
];

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

export type WeekPick = { crest: string | null; label: string };

function Table({
  title,
  subtitle,
  rows,
  highlightUserId,
  picksOf,
  weekLabel,
}: {
  title: string;
  subtitle?: string;
  rows: StandingRow[];
  highlightUserId: string;
  /** This round's picks per player, as badges. */
  picksOf: (userId: string) => WeekPick[];
  weekLabel: string | null;
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="label">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-xs text-grey-500">{subtitle}</p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[22rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-grey-300 text-left text-xs uppercase tracking-wider text-grey-500">
              <th className="w-10 py-2 font-medium">Pos</th>
              <th className="py-2 font-medium">Player</th>
              {weekLabel && (
                <th className="hidden w-28 py-2 font-medium sm:table-cell">
                  {weekLabel} picks
                </th>
              )}
              <th className="w-16 py-2 text-right font-medium">Played</th>
              <th className="w-16 py-2 text-right font-medium">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.userId}
                className={`border-b border-grey-100 ${
                  row.userId === highlightUserId
                    ? 'bg-lime/10'
                    : ''
                }`}
              >
                <td className="numeric py-2.5 text-grey-400">
                  {row.position}
                  {row.tied && <span aria-label="tied">=</span>}
                </td>
                <td className="py-2.5">
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-on-accent"
                      style={{ background: PALETTE[index % PALETTE.length] }}
                    >
                      {initials(row.displayName)}
                    </span>
                    {row.displayName}
                  </span>
                </td>
                {weekLabel && (
                  <td className="hidden py-2.5 sm:table-cell">
                    <span className="flex items-center gap-1">
                      {picksOf(row.userId).length === 0 ? (
                        <span className="text-xs text-grey-400">&mdash;</span>
                      ) : (
                        picksOf(row.userId).map((p, i) =>
                          p.crest ? (
                            <Crest
                              key={i}
                              url={p.crest}
                              alt={p.label}
                              className="h-5 w-5"
                            />
                          ) : (
                            // A called draw has no single club to show.
                            <span
                              key={i}
                              title={p.label}
                              className="flex h-5 w-5 items-center justify-center rounded-full bg-grey-300 text-[9px] font-bold text-on-accent"
                            >
                              D
                            </span>
                          ),
                        )
                      )}
                    </span>
                  </td>
                )}
                <td className="py-2.5 text-right tabular-nums text-grey-500">
                  {row.gameweeksPlayed}
                </td>
                <td className="numeric py-2.5 text-right text-base">
                  {row.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function TablePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: memberships } = await supabase
    .from('league_members')
    .select('league_id, leagues(id, name)')
    .eq('user_id', user!.id);

  const league = (memberships ?? [])
    .map((m) => m.leagues)
    .filter((l): l is NonNullable<typeof l> => Boolean(l))[0];

  const heading = (
    <div>
      <h1 className="display-lg">Table</h1>
      <p className="mt-2 text-grey-700">
        One point per correct result. Divisions run alongside the overall
        standings.
      </p>
      <div className="mt-4">
        <TableScopeToggle scope="league" />
      </div>
    </div>
  );

  if (!league) {
    return (
      <div className="flex flex-col gap-8">
        {heading}
        <div className="card p-6">
          <h2 className="font-medium">You&rsquo;re not in a league yet</h2>
          <p className="mt-2 text-sm text-grey-700">
            Join or create one on the{' '}
            <Link href="/leagues" className="underline underline-offset-4">
              leagues page
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  const { data: season } = await supabase
    .from('seasons')
    .select('id, name')
    .eq('is_active', true)
    .maybeSingle();

  const seasonId = season?.id ?? '00000000-0000-0000-0000-000000000000';

  // Divisions are per-season — this shows the current arrangement, not every
  // division the league has ever had.
  const [{ data: divisions }, { data: divisionMembers }] = await Promise.all([
    supabase
      .from('divisions')
      .select('id, name, tier')
      .eq('league_id', league.id)
      .eq('season_id', seasonId)
      .order('tier', { ascending: true }),
    supabase
      .from('division_members')
      .select('division_id, user_id')
      .eq('league_id', league.id)
      .eq('season_id', seasonId),
  ]);

  const userIds = (divisionMembers ?? []).map((m) => m.user_id);

  const [{ data: profiles }, { data: scores }, { count: settledCount }] =
    await Promise.all([
      supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']),
      supabase
        .from('gameweek_scores')
        .select('user_id, points, gameweek_id')
        .in('user_id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']),
      supabase
        .from('gameweeks')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'settled'),
    ]);

  const nameOf = (id: string) =>
    profiles?.find((p) => p.id === id)?.display_name ?? 'Player';

  const totalsFor = (ids: string[]) =>
    ids.map((id) => {
      const mine = (scores ?? []).filter((s) => s.user_id === id);
      return {
        userId: id,
        displayName: nameOf(id),
        points: mine.reduce((sum, s) => sum + (s.points ?? 0), 0),
        gameweeksPlayed: mine.length,
      };
    });

  // ---- This round's picks, as badges ----
  //
  // The table has no clubs on it otherwise: it ranks players. Showing what
  // each of them has taken this round is the one place a crest belongs here,
  // and it answers the question you actually have looking at a table
  // mid-week — not just who is ahead, but what they are holding.
  //
  // Picks within a league are already public: the board shows what a
  // division-mate has taken the moment they take it, and what other
  // divisions took as well. Nothing is revealed here that the draft doesn't.
  const divisionIds = (divisions ?? []).map((d) => d.id);
  type LeagueDraft = {
    id: string;
    gameweek_id: string;
    gameweeks: { number: number; name: string | null } | { number: number; name: string | null }[] | null;
  };

  const leagueDrafts: LeagueDraft[] = divisionIds.length
    ? (((
        await supabase
          .from('drafts')
          .select('id, gameweek_id, gameweeks(number, name)')
          .in('division_id', divisionIds)
      ).data ?? []) as unknown as LeagueDraft[])
    : [];

  const picksOfUser = new Map<string, WeekPick[]>();
  let weekLabel: string | null = null;

  if (leagueDrafts.length) {
    // The latest round anyone has actually picked in.
    const byGameweek = new Map<string, { number: number; ids: string[] }>();
    for (const d of leagueDrafts) {
      const gw = Array.isArray(d.gameweeks) ? d.gameweeks[0] : d.gameweeks;
      const entry = byGameweek.get(d.gameweek_id) ?? {
        number: gw?.number ?? 0,
        ids: [],
      };
      entry.ids.push(d.id);
      byGameweek.set(d.gameweek_id, entry);
    }

    const ordered = [...byGameweek.values()].sort((a, b) => b.number - a.number);
    for (const round of ordered) {
      const { data: roundPicks } = await supabase
        .from('picks')
        .select(
          `user_id, predicted_outcome, pick_number,
           fixtures(
             home:teams!fixtures_home_team_id_fkey(name, crest_url),
             away:teams!fixtures_away_team_id_fkey(name, crest_url)
           )`,
        )
        .in('draft_id', round.ids)
        .order('pick_number');

      if (!roundPicks?.length) continue;

      const one = <T,>(v: T | T[]): T => (Array.isArray(v) ? v[0] : v);
      for (const pick of roundPicks) {
        const fixture = one(pick.fixtures) as {
          home: { name: string; crest_url: string | null };
          away: { name: string; crest_url: string | null };
        } | null;
        if (!fixture) continue;
        const home = one(fixture.home);
        const away = one(fixture.away);

        const called =
          pick.predicted_outcome === 'HOME'
            ? { crest: home.crest_url, label: home.name }
            : pick.predicted_outcome === 'AWAY'
              ? { crest: away.crest_url, label: away.name }
              : { crest: null, label: `Draw — ${home.name} v ${away.name}` };

        const list = picksOfUser.get(pick.user_id) ?? [];
        list.push(called);
        picksOfUser.set(pick.user_id, list);
      }

      weekLabel = `GW${round.number}`;
      break;
    }
  }

  const picksOf = (userId: string) => picksOfUser.get(userId) ?? [];

  const overall = rank(totalsFor(userIds));

  if (userIds.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        {heading}
        <div className="card p-6">
          <h2 className="font-medium">No divisions yet</h2>
          <p className="mt-2 text-sm text-grey-700">
            {league.name} has no divisions, so there&rsquo;s nothing to rank. The
            league owner needs to arrange members into divisions on the{' '}
            <Link
              href={`/leagues/${league.id}`}
              className="underline underline-offset-4"
            >
              league page
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {heading}

      {(settledCount ?? 0) === 0 && (
        <p className="card px-4 py-3 text-sm text-grey-700">
          No gameweek has been settled yet, so everyone is on zero. Points appear
          once results come in and the gameweek is scored.
        </p>
      )}

      <Table
        title={`${league.name} — overall`}
        subtitle={`${userIds.length} players`}
        rows={overall}
        highlightUserId={user!.id}
        picksOf={picksOf}
        weekLabel={weekLabel}
      />

      {(divisions ?? []).map((division) => {
        const ids = (divisionMembers ?? [])
          .filter((m) => m.division_id === division.id)
          .map((m) => m.user_id);
        return (
          <Table
            key={division.id}
            title={division.name}
            subtitle={`Tier ${division.tier}`}
            rows={rank(totalsFor(ids))}
            highlightUserId={user!.id}
            picksOf={picksOf}
            weekLabel={weekLabel}
          />
        );
      })}

      <p className="text-xs leading-relaxed text-grey-500">
        Players level on points share a position, shown with{' '}
        <span className="font-medium">=</span>. There is no tiebreak &mdash; the
        spreadsheet this game comes from ranks on total points alone.
      </p>
    </div>
  );
}
