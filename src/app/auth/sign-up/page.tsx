import { AuthForm } from '@/components/AuthForm';
import { signUp } from '@/lib/actions/auth';

export const metadata = { title: 'Create account' };

export default function SignUpPage() {
  return (
    <>
      <h1 className="display-md mb-5">Create account</h1>
      <AuthForm mode="sign-up" action={signUp} />
    </>
  );
}
