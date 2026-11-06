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
          <Mark tone="theme" plate={false} className="h-12 w-12" />
          <span className="font-display flex flex-col text-left text-[13px] leading-[1.15] font-bold tracking-[0.18em] uppercase">
            <span>Lock</span>
            <span>Your</span>
            <span className="text-lime-dark">Picks</span>
          </span>
        </Link>
        <div className="card p-6">{children}</div>
      </div>
    </div>
  );
}
