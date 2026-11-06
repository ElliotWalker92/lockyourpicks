import Link from 'next/link';

import { Mark } from '@/components/Mark';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-14">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 flex items-center justify-center gap-2.5"
        >
          <Mark tone="ink" className="h-9 w-9" />
          <span className="flex flex-col text-left leading-none">
            <span className="font-display text-[10px] font-bold tracking-[0.2em] text-grey-500 uppercase">
              Lock Your
            </span>
            <span className="font-display mt-0.5 text-2xl font-extrabold tracking-tight">
              Picks
            </span>
          </span>
        </Link>
        <div className="card p-6">{children}</div>
      </div>
    </div>
  );
}
