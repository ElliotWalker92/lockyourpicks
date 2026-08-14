'use client';

import { LockIcon } from '@/components/LockIcon';
import { formatPct } from '@/lib/elo';
import { buildModel, formRun, type FormRun } from '@/lib/model';

export type ModelTeam = {
  name: string;
  elo: number;
  form: ('W' | 'D' | 'L')[];
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

  const model = buildModel({
    homeElo: home.elo,
    awayElo: away.elo,
    homeForm,
    awayForm,
    crowdCounts,
  });

  const edge = Math.round(home.elo + 100 - away.elo);

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
            Elo, form and the crowd combined
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
            <Bar p={model.elo} homeName={home.name} awayName={away.name} compact />
          </span>
          <span className="shrink-0 text-xs text-grey-500 tabular-nums">
            {Math.round(home.elo)} v {Math.round(away.elo)}
            {edge !== 0 && (
              <> &middot; {edge > 0 ? home.name : away.name} +{Math.abs(edge)}</>
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
              ? `${model.crowd.sample} pick${model.crowd.sample === 1 ? '' : 's'}${
                  model.weights.crowd < 0.15 ? ' · small sample' : ''
                }`
              : '—'}
          </span>
        </div>
      </div>

      {otherPicks.length > 0 && (
        <div className="border-t border-grey-300 pt-3">
          <p className="label">Taken elsewhere</p>
          <ul className="mt-1.5 flex flex-col gap-1 text-sm text-grey-700">
            {otherPicks.map((o, i) => (
              <li key={i}>
                <span className="font-medium">{o.division}</span> called{' '}
                {o.called}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs leading-relaxed text-grey-500">
        Elo from last season and this, form from the last {FORM_MAX} results,
        crowd from every division&rsquo;s picks this gameweek. A guide, not a
        tip &mdash; none of it knows who&rsquo;s injured.
      </p>
    </div>
  );
}

const FORM_MAX = 5;
