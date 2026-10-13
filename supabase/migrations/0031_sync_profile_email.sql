-- ============================================================
--  0031 — keep a profile's email in step with the account's
--
--  profiles.email is copied from auth.users when the account is created,
--  by a trigger that fires on insert and only on insert. Nothing has ever
--  kept the two in step afterwards, and changing your address in the app
--  changes the account, not the profile.
--
--  Every notification this app sends reads profiles.email. So Matt, whose
--  address was set properly on his account weeks ago, had turn emails
--  going to the matt@lockyourpicks.invalid placeholder he was imported
--  with — silently, because a placeholder is deliberately skipped rather
--  than treated as a failure. He was auto-picked in gameweek 15 without
--  ever being told it was his turn.
--
--  The account is the authority: it is the address somebody proved they
--  control and the one a password reset goes to. Having notifications go
--  somewhere else is not a second preference, it is a bug with two values.
-- ============================================================

create or replace function public.sync_profile_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set email = new.email,
         updated_at = now()
   where id = new.id
     and email is distinct from new.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute procedure public.sync_profile_email();


-- Bring the existing rows into line. One of these is Matt's placeholder,
-- already corrected by hand so this will pass over it; the other is a
-- profile still carrying the address its player was imported with, while
-- their account has since moved to a different one.
update public.profiles p
   set email = u.email,
       updated_at = now()
  from auth.users u
 where u.id = p.id
   and p.email is distinct from u.email;
