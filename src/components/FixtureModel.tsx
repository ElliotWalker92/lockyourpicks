'use client';

import { matchProbabilities, formatPct } from '@/lib/elo';

export type ModelTeam = { name: string; elo: number };

/**
 * The model's read on a fixture: Elo → win/draw/loss.
 *
 * Deliberately *not* blended with a crowd percentage the way the WC2026 app
 * was. There, dozens of players all predicted every match, so the pick
 * distribution was a real signal. Here a fixture can be taken at most once per
 * division, so "the crowd" on any given match is at most a handful of picks —
 * and within your own division, exactly zero or one. Averaging that into the
 * model would dress up noise as a second opinion.
 *
 * What other divisions did with the fixture is shown separately below, as a
 * fact rather than a probability.
 */
export function FixtureModel({
  home,
  away,
  otherPicks,
}: {
  home: ModelTeam;
  away: ModelTeam;
  otherPicks: { division: string; called: string }[];
}) {
  const p = matchProbabilities(home.elo, away.elo);
  const edge = Math.round(home.elo + 100 - away.elo);

  const bars = [
    { label: home.name, value: p.home, tone: 'bg-lime' },
    { label: 'Draw', value: p.draw, tone: 'bg-grey-300' },
    { label: away.name, value: p.away, tone: 'bg-grey-500' },
  ];

  return (
    <div className="flex flex-col gap-4 border-t border-grey-300 bg-surface px-3 py-4">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="label">Model</p>
          <p className="text-xs text-grey-500">
            Elo {Math.round(home.elo)} v {Math.round(away.elo)}
            {' · '}
            {edge === 0
              ? 'level'
              : `${edge > 0 ? home.name : away.name} +${Math.abs(edge)} at home`}
          </p>
        </div>

        {/* Single stacked bar — the three outcomes are one distribution, and
            three separate bars invite reading them as unrelated. */}
        <div className="mt-2.5 flex h-2.5 w-full overflow-hidden rounded-full">
          {bars.map((b) => (
            <div
              key={b.label}
              className={b.tone}
              style={{ width: `${b.value * 100}%` }}
              title={`${b.label} ${formatPct(b.value)}`}
            />
          ))}
        </div>

        <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {bars.map((b) => (
            <div key={b.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={`h-2.5 w-2.5 rounded-full ${b.tone}`}
              />
              <dt className="text-grey-700">{b.label}</dt>
              <dd className="font-medium tabular-nums">
                {formatPct(b.value)}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {otherPicks.length > 0 && (
        <div>
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
        Ratings are computed from last season and this one, seeded by division.
        A guide, not a tip &mdash; the model has no idea who&rsquo;s injured.
      </p>
    </div>
  );
}
