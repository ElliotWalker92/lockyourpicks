import { AuthForm } from '@/components/AuthForm';
import { signIn } from '@/lib/actions/auth';

export const metadata = { title: 'Sign in' };

/**
 * A failed email link used to land here with no explanation, which reads as
 * the app being broken rather than the link being stale.
 */
const REASONS: Record<string, string> = {
  expired:
    'That link has expired or has already been used. Request a new one below.',
  link: 'That link didn’t carry a valid sign-in code. Request a new one below.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const reason = error ? REASONS[error] : null;

  return (
    <>
      <h1 className="display-md mb-5">Sign in</h1>

      {reason && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-loss/30 bg-loss/5 px-3 py-2 text-sm text-loss"
        >
          {reason}
        </p>
      )}

      <AuthForm mode="sign-in" action={signIn} />
    </>
  );
}
