'use client';

import { LockIcon } from '@/components/LockIcon';
import { formatPct } from '@/lib/elo';
import type { TeamTable } from '@/lib/ingest/form';
import {
  buildModel,
  formRun,
  type FormRun,
  MIN_CROWD,
  type ModelLayers,
} from '@/lib/model';

export type ModelTeam = {
  name: string;
  /** Null for a club nothing has been computed for — see migration 0040. */
  elo: number | null;
  form: ('W' | 'D' | 'L')[];
  table: TeamTable | null;
};

/** Home lime, draw grey, away electric blue — same as the WC2026 app. */
const TONE = {
  home: 'bg-lime',
  draw: 'bg-grey-300',
  away: 'bg-away',
} as const;

function Bar({
  p,
  homeName,
  awayName,
  compact = false,
}: {
  p: { home: number; draw: number; away: number };
  homeName: string;
  awayName: string;
  compact?: boolean;
}) {
  const segs = [
    { k: 'home' as const, v: p.home, label: homeName },
    { k: 'draw' as const, v: p.draw, label: 'Draw' },
    { k: 'away' as const, v: p.away, label: awayName },
  ];
  return (
    <div
      className={`flex w-full overflow-hidden rounded-full ${compact ? 'h-1.5' : 'h-2.5'}`}
    >
      {segs.map((s) => (
        <div
          key={s.k}
          className={TONE[s.k]}
          style={{ width: `${s.v * 100}%` }}
          title={`${s.label} ${formatPct(s.v)}`}
        />
      ))}
    </div>
  );
}

/** W/D/L pills, most recent last. */
function FormPills({ run }: { run: ('W' | 'D' | 'L')[] }) {
  if (!run.length) {
    return <span className="text-xs text-grey-400">no results yet</span>;
  }
  return (
    <span className="flex gap-1">
      {run.map((r, i) => (
        <span
          key={i}
          className={`flex h-4 w-4 items-center justify-center rounded-sm text-[9px] font-bold ${
            r === 'W'
              ? 'bg-win/20 text-win'
              : r === 'D'
                ? 'bg-grey-300 text-grey-700'
                : 'bg-loss/20 text-loss'
          }`}
          title={r === 'W' ? 'Win' : r === 'D' ? 'Draw' : 'Loss'}
        >
          {r}
        </span>
      ))}
    </span>
  );
}

/**
 * What the model makes of a fixture: Elo, recent form, and the crowd.
 *
 * Each layer is shown as well as the blend. A single combined percentage
 * hides whether the layers agree, which is the part worth knowing — a fixture
 * where Elo and form point opposite ways is a different proposition from one
 * where they line up.
 */
export function FixtureModel({
  home,
  away,
  crowdCounts,
  otherPicks,
}: {
  home: ModelTeam;
  away: ModelTeam;
  crowdCounts: { home: number; draw: number; away: number };
  otherPicks: { division: string; called: string }[];
}) {
  const homeForm: FormRun = formRun(home.form);
  const awayForm: FormRun = formRun(away.form);

  // Each side is read at the venue it is actually playing at.
  const homeTable = home.table
    ? {
        ppg: home.table.homePpg,
        played: home.table.homePlayed,
        competitionId: home.table.competitionId,
        rank: home.table.rank,
      }
    : null;
  const awayTable = away.table
    ? {
        ppg: away.table.awayPpg,
        played: away.table.awayPlayed,
        competitionId: away.table.competitionId,
        rank: away.table.rank,
      }
    : null;

  const model = buildModel({
    homeElo: home.elo,
    awayElo: away.elo,
    homeTable,
    awayTable,
    homeForm,
    awayForm,
    crowdCounts,
  });

  const edge =
    home.elo === null || away.elo === null
      ? null
      : Math.round(home.elo + 100 - away.elo);

  // Every layer came up empty, which happens on a cup tie between a club we
  // hold no results for and one whose table isn't comparable. Saying so is
  // the whole point: a bar drawn from one surviving weak layer looks exactly
  // as confident as one drawn from all four.
  if (!model) {
    return (
      <div className="flex flex-col gap-2 border-t border-grey-300 bg-surface px-3 py-4">
        <p className="label flex items-center gap-1.5">
          <LockIcon className="h-3 w-3" />
          Model
        </p>
        <p className="text-sm text-grey-700">
          Nothing to go on for this one.
        </p>
        <p className="text-xs leading-relaxed text-grey-500">
          {home.elo === null || away.elo === null ? (
            <>
              No rating for{' '}
              {home.elo === null && away.elo === null
                ? 'either side'
                : home.elo === null
                  ? home.name
                  : away.name}
              {' '}&mdash; no results we hold and no division to go by. The
              sides aren&rsquo;t in a comparable table either, and nobody has
              taken it yet.
            </>
          ) : (
            <>Not enough played yet, and nobody has taken it.</>
          )}
        </p>
        {otherPicks.length > 0 && <TakenElsewhere picks={otherPicks} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 border-t border-grey-300 bg-surface px-3 py-4">
      {/* ---- Combined ---- */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="label flex items-center gap-1.5">
            <LockIcon className="h-3 w-3" />
            Model
          </p>
          <p className="text-xs text-grey-500">
            {/* Names the layers actually carrying weight. Claiming all four
                when one of them contributed nothing is a small lie that
                makes the bar look better founded than it is. */}
            {usedLayers(model.weights)}
          </p>
        </div>

        <div className="mt-2.5">
          <Bar
            p={model.blended}
            homeName={home.name}
            awayName={away.name}
          />
        </div>

        <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {(
            [
              ['home', home.name, model.blended.home],
              ['draw', 'Draw', model.blended.draw],
              ['away', away.name, model.blended.away],
            ] as const
          ).map(([k, label, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${TONE[k]}`} />
              <dt className="text-grey-700">{label}</dt>
              <dd className="font-medium tabular-nums">{formatPct(v)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* ---- The layers behind it ---- */}
      <div className="flex flex-col gap-3 border-t border-grey-300 pt-3">
        {/* Elo */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="w-14 shrink-0 text-xs font-medium text-grey-700">
            Elo
          </span>
          <span className="min-w-32 flex-1">
            {model.elo ? (
              <Bar p={model.elo} homeName={home.name} awayName={away.name} compact />
            ) : (
              <span className="text-xs text-grey-400">
                {home.elo === null && away.elo === null
                  ? 'neither side rated'
                  : `${home.elo === null ? home.name : away.name} isn't rated`}
              </span>
            )}
          </span>
          <span className="shrink-0 text-xs text-grey-500 tabular-nums">
            {edge === null ? (
              '—'
            ) : (
              <>
                {Math.round(home.elo!)} v {Math.round(away.elo!)}
                {edge !== 0 && (
                  <> &middot; {edge > 0 ? home.name : away.name} +{Math.abs(edge)}</>
                )}
              </>
            )}
          </span>
        </div>

        {/* Table */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="w-14 shrink-0 text-xs font-medium text-grey-700">
            Table
          </span>
          <span className="min-w-32 flex-1">
            {model.table ? (
              <Bar
                p={model.table}
                homeName={home.name}
                awayName={away.name}
                compact
              />
            ) : (
              <span className="text-xs text-grey-400">
                {homeTable && awayTable
                  ? 'not enough games yet'
                  : 'different divisions — no comparable table'}
              </span>
            )}
          </span>
          <span className="shrink-0 text-xs text-grey-500 tabular-nums">
            {homeTable && awayTable ? (
              <>
                {ordinal(homeTable.rank)} v {ordinal(awayTable.rank)}
                {' · '}
                {homeTable.ppg.toFixed(1)} home v {awayTable.ppg.toFixed(1)} away
              </>
            ) : (
              '—'
            )}
          </span>
        </div>

        {/* Form */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="w-14 shrink-0 text-xs font-medium text-grey-700">
            Form
          </span>
          <span className="min-w-32 flex-1">
            {model.form ? (
              <Bar p={model.form} homeName={home.name} awayName={away.name} compact />
            ) : (
              <span className="text-xs text-grey-400">
                not enough results yet
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <FormPills run={home.form} />
            <span className="text-xs text-grey-400">v</span>
            <FormPills run={away.form} />
          </span>
        </div>

        {/* Crowd */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="w-14 shrink-0 text-xs font-medium text-grey-700">
            Crowd
          </span>
          <span className="min-w-32 flex-1">
            {model.crowd ? (
              <Bar
                p={model.crowd}
                homeName={home.name}
                awayName={away.name}
                compact
              />
            ) : (
              <span className="text-xs text-grey-400">nobody has taken it</span>
            )}
          </span>
          <span className="shrink-0 text-xs text-grey-500">
            {model.crowd
              ? // Keyed on the sample, not the weight. The weight is scaled
                // back up when it's the only layer left, so on exactly the
                // fixture where "two picks" needs saying out loud, a test
                // against the weight stopped saying it.
                `${model.crowd.sample} pick${model.crowd.sample === 1 ? '' : 's'}${
                  model.crowd.sample < MIN_CROWD ? ' · small sample' : ''
                }`
              : '—'}
          </span>
        </div>
      </div>

      {otherPicks.length > 0 && <TakenElsewhere picks={otherPicks} />}

      <p className="text-xs leading-relaxed text-grey-500">
        Elo from last season and this; the table read by venue &mdash; home
        side&rsquo;s home record against the away side&rsquo;s away record;
        form from the last {FORM_MAX} results; crowd from every
        division&rsquo;s picks this gameweek. A guide, not a tip &mdash; none
        of it knows who&rsquo;s injured.
      </p>
    </div>
  );
}

/** Which other divisions have taken this one, and which way they called it. */
function TakenElsewhere({
  picks,
}: {
  picks: { division: string; called: string }[];
}) {
  return (
    <div className="border-t border-grey-300 pt-3">
      <p className="label">Taken elsewhere</p>
      <ul className="mt-1.5 flex flex-col gap-1 text-sm text-grey-700">
        {picks.map((o, i) => (
          <li key={i}>
            <span className="font-medium">{o.division}</span> called {o.called}
          </li>
        ))}
      </ul>
    </div>
  );
}

const FORM_MAX = 5;

/**
 * "Elo, the table, form and the crowd combined" — but only the layers with
 * weight behind them, so a fixture missing one doesn't claim it anyway.
 */
function usedLayers(weights: ModelLayers['weights']) {
  const names = [
    [weights.elo, 'Elo'],
    [weights.table, 'the table'],
    [weights.form, 'form'],
    [weights.crowd, 'the crowd'],
  ] as const;
  const on = names.filter(([w]) => w > 0).map(([, n]) => n);
  if (on.length === 1) return `${on[0]} only`;
  return `${on.slice(0, -1).join(', ')} and ${on[on.length - 1]} combined`;
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
