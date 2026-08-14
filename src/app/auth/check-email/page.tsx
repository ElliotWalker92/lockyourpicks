export const metadata = { title: 'Check your email · Lock Your Picks' };

export default function CheckEmailPage() {
  return (
    <div className="text-center">
      <h1 className="mb-3 text-2xl font-semibold tracking-tight">
        Check your email
      </h1>
      <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
        We&rsquo;ve sent you a confirmation link. Click it to activate your
        account, then come back and sign in.
      </p>
    </div>
  );
}
