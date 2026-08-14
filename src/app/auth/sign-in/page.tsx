import { AuthForm } from '@/components/AuthForm';
import { signIn } from '@/lib/actions/auth';

export const metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <>
      <h1 className="display-md mb-5">Sign in</h1>
      <AuthForm mode="sign-in" action={signIn} />
    </>
  );
}
