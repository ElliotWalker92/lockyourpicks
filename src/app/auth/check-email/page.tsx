export const metadata = { title: 'Check your email' };

export default function CheckEmailPage() {
  return (
    <div className="text-center">
      <h1 className="mb-3 display-lg">
        Check your email
      </h1>
      <p className="text-sm leading-relaxed text-grey-700">
        We&rsquo;ve sent you a confirmation link. Click it to activate your
        account, then come back and sign in.
      </p>
    </div>
  );
}
