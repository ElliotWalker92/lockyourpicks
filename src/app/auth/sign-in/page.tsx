import { AuthForm } from '@/components/AuthForm';
import { signIn } from '@/lib/actions/auth';

export const metadata = { title: 'Sign in · Lock Your Picks' };

export default function SignInPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Sign in</h1>
      <AuthForm mode="sign-in" action={signIn} />
    </>
  );
}
