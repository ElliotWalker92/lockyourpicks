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


-- Only the placeholders are backfilled, not every difference.
--
-- A profile whose address differs from the account's is not necessarily
-- stale. Besty's account carries the address he signed up with in August;
-- his profile was moved to a different real address in September, after it,
-- and that later one is where he reads his mail. Syncing everything would
-- have quietly moved him back to the older address — fixing one player by
-- breaking another.
--
-- A placeholder is different: nobody chose it, it was invented by the
-- import so a row could exist before the player did, and mail to it goes
-- nowhere by design. Those are safe to overwrite with the real account
-- address, and from here the trigger keeps the two in step.
update public.profiles p
   set email = u.email,
       updated_at = now()
  from auth.users u
 where u.id = p.id
   and p.email like '%.invalid'
   and u.email not like '%.invalid'
   and p.email is distinct from u.email;
