import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Dashboard · Lock Your Picks' };

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: season }, { count: fixtureCount }, { data: leagues }] =
    await Promise.all([
      supabase
        .from('seasons')
        .select('name, starts_on, ends_on')
        .eq('is_active', true)
        .maybeSingle(),
      supabase.from('fixtures').select('*', { count: 'exact', head: true }),
      supabase.from('leagues').select('id, name, join_code'),
    ]);

  const setupSteps = [
    { label: 'Active season', done: Boolean(season), detail: season?.name },
    {
      label: 'Fixtures loaded',
      done: (fixtureCount ?? 0) > 0,
      detail: fixtureCount ? `${fixtureCount} fixtures` : 'none yet',
    },
    {
      label: 'League created',
      done: (leagues?.length ?? 0) > 0,
      detail: leagues?.length ? `${leagues.length}` : 'none yet',
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          {season
            ? `${season.name} season is live.`
            : 'No season is set up yet.'}
        </p>
      </div>

      <section className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Setup
        </h2>
        <ul className="mt-4 flex flex-col gap-3">
          {setupSteps.map((step) => (
            <li key={step.label} className="flex items-center gap-3 text-sm">
              <span
                aria-hidden
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                  step.done
                    ? 'bg-lime-300 text-neutral-900'
                    : 'border border-neutral-300 text-neutral-400 dark:border-neutral-700'
                }`}
              >
                {step.done ? '✓' : ''}
              </span>
              <span className="flex-1">{step.label}</span>
              <span className="text-neutral-500">{step.detail}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm leading-relaxed text-neutral-500">
          Fixtures arrive once the API-Football key is configured and the
          ingestion job runs. Until then the draft has nothing to draft from.
        </p>
      </section>
    </div>
  );
}
