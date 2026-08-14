import { notFound } from 'next/navigation';

import { ArrangeDivisions } from '@/components/ArrangeDivisions';
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
        .select('division_id, user_id')
        .eq('league_id', id)
        .eq('season_id', seasonId),
    ]);

  const userIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_color')
    .in('id', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000']);

  const nameOf = (userId: string) =>
    profiles?.find((p) => p.id === userId)?.display_name ?? 'Player';
  const colourOf = (userId: string) =>
    profiles?.find((p) => p.id === userId)?.avatar_color ?? '#c8f135';

  const isOwner = league.owner_id === user!.id;
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
                          className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-ink"
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

        {isOwner && (
          <div className="pt-2">
            <ArrangeDivisions
              leagueId={league.id}
              hasDivisions={Boolean(divisions?.length)}
            />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="label">
          All players
        </h2>
        <ul className="flex flex-col gap-2">
          {(members ?? []).map((m) => (
            <li key={m.user_id} className="flex items-center gap-2.5 text-sm">
              <span
                aria-hidden
                className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-ink"
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
    </div>
  );
}
