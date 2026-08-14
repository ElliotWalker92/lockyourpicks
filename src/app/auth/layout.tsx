import Link from 'next/link';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 block text-center text-sm font-medium uppercase tracking-widest text-neutral-500 transition hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          Lock Your Picks
        </Link>
        {children}
      </div>
    </div>
  );
}
