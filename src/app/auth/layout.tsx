import Link from 'next/link';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-14">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center">
          <span className="font-serif text-xl italic">Lock Your Picks</span>
        </Link>
        <div className="card p-6">{children}</div>
      </div>
    </div>
  );
}
