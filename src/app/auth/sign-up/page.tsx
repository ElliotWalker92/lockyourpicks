import { AuthForm } from '@/components/AuthForm';
import { signUp } from '@/lib/actions/auth';

export const metadata = { title: 'Create account · Lock Your Picks' };

export default function SignUpPage() {
  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        Create account
      </h1>
      <AuthForm mode="sign-up" action={signUp} />
    </>
  );
}
