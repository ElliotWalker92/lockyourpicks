import Link from 'next/link';

/**
 * Switches between your league's table and the global one.
 *
 * They were separate tabs, which put three table-shaped things in the nav —
 * your table, the global table, and the real football tables — and left the
 * player working out which was which. These two are the same idea at two
 * scales, so they share a tab and this chooses the scale.
 */
export function TableScopeToggle({ scope }: { scope: 'league' | 'global' }) {
  const options = [
    { key: 'league', href: '/table', label: 'Your group' },
    { key: 'global', href: '/leaderboard', label: 'Everyone' },
  ] as const;

  return (
    <div
      role="tablist"
      aria-label="Table scope"
      className="inline-flex rounded-lg border border-grey-300 bg-card p-0.5"
    >
      {options.map((option) => {
        const active = option.key === scope;
        return (
          <Link
            key={option.key}
            href={option.href}
            role="tab"
            aria-selected={active}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
              active
                ? 'bg-panel text-white'
                : 'text-grey-500 hover:text-ink'
            }`}
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}
