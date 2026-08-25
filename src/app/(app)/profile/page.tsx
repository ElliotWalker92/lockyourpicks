import {
  AvatarUploader,
  DetailsForm,
  EmailForm,
  PasswordForm,
} from '@/components/ProfileForms';
import { signOut } from '@/lib/actions/auth';
import { NotifyToggle } from '@/components/NotifyToggle';
import { ThemeToggle } from '@/components/ThemeToggle';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Profile' };

function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="display-md">{title}</h2>
      {description && (
        <p className="mt-1 mb-4 text-sm text-grey-700">{description}</p>
      )}
      <div className={description ? '' : 'mt-4'}>{children}</div>
    </section>
  );
}

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_color, avatar_url, notify_turn')
    .eq('id', user!.id)
    .single();

  const name = profile?.display_name ?? user!.email?.split('@')[0] ?? 'Player';
  const colour = profile?.avatar_color ?? '#c8f135';

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="label">Your account</p>
        <h1 className="display-lg mt-1">Profile</h1>
      </div>

      <div className="flex flex-col gap-5">
        <Section
          title="Picture"
          description="Shown next to your name on the draft board and tables."
        >
          <AvatarUploader
            userId={user!.id}
            avatarUrl={profile?.avatar_url ?? null}
            avatarColor={colour}
            initials={initialsOf(name)}
          />
        </Section>

        <Section
          title="Notifications"
          description="An async draft only works if you know it's your go."
        >
          <NotifyToggle enabled={profile?.notify_turn ?? true} />
        </Section>

        <Section
          title="Appearance"
          description="Kept on this device, so it won't follow you to another one."
        >
          <ThemeToggle />
        </Section>

        <Section title="Details">
          <DetailsForm displayName={name} avatarColor={colour} />
        </Section>

        <Section title="Email">
          <EmailForm email={user!.email ?? ''} />
        </Section>

        <Section title="Password">
          <PasswordForm />
        </Section>

        {/* Phones don't get a Sign out in the header — the bottom tab bar
            takes that space — so it lives here. */}
        <section className="card p-5 sm:hidden">
          <form action={signOut}>
            <button type="submit" className="btn btn-outline w-full">
              Sign out
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
