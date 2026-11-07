-- ============================================================
--  Blank the profile AFTER scrubbing the auth row, not before
--
--  0054 did it the other way round and 0031 undid half of it. That
--  migration added `on_auth_user_email_changed`, which copies
--  auth.users.email into profiles.email whenever the account's address
--  changes -- so the order in 0054 was:
--
--     1. profiles.email := null
--     2. auth.users.email := 'deleted+<uuid>@lockyourpicks.invalid'
--     3. the trigger fires and writes that straight back into profiles
--
--  and the profile ended up holding the placeholder instead of
--  nothing. Not a leak -- the real address was gone either way -- but
--  not what the function says it does, and found only by running the
--  whole thing against a real stack, since the trigger lives in a
--  migration a hand-written mock of auth.users does not have.
--
--  Swapping the two steps fixes it: the trigger's write happens first
--  and the blanking lands on top. Anything added here that touches
--  auth.users has to stay above the profile update for the same
--  reason.
-- ============================================================

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  lg   record;
  heir uuid;
begin
  if uid is null then
    raise exception 'delete_own_account: not signed in';
  end if;

  -- A league this person owns has to end up somewhere. One with other
  -- people in it passes to whoever joined first -- they have the most
  -- invested and it needs no decision from anyone. A league that is
  -- only them goes with them.
  for lg in select id from public.leagues where owner_id = uid loop
    select lm.user_id
      into heir
      from public.league_members lm
     where lm.league_id = lg.id
       and lm.user_id <> uid
     order by lm.joined_at, lm.user_id
     limit 1;

    if heir is null then
      delete from public.leagues where id = lg.id;
    else
      update public.leagues set owner_id = heir where id = lg.id;
    end if;
  end loop;

  -- Devices. Nothing here is history, and a push to a dead account is
  -- noise aimed at a phone that no longer has any business receiving it.
  delete from public.push_subscriptions where user_id = uid;

  -- Drop live sessions before touching the credentials, so a tab left
  -- open on another device stops being able to act straight away
  -- rather than at the end of its token's life.
  delete from auth.sessions   where user_id = uid;
  delete from auth.identities where user_id = uid;

  -- The account itself. The address is freed as a side effect, which is
  -- deliberate: someone who deletes an account and later wants another
  -- should be able to sign up with the same email.
  --
  -- banned_until is belt and braces next to the scrambled password --
  -- it is what GoTrue checks before it will mint a new token, so any
  -- refresh that races this update still fails.
  update auth.users
     set email              = 'deleted+' || uid::text || '@lockyourpicks.invalid',
         encrypted_password = '!account-deleted',
         raw_user_meta_data = '{}'::jsonb,
         email_change       = '',
         banned_until       = now() + interval '100 years',
         updated_at         = now()
   where id = uid;

  -- Last, so the email sync triggered by the update above is overwritten
  -- rather than overwriting. The profile row itself stays, because the
  -- draft board and the tables join to it for a name.
  update public.profiles
     set display_name = 'Deleted player',
         email        = null,
         avatar_url   = null,
         avatar_color = '#c8f135',
         updated_at   = now()
   where id = uid;
end;
$$;

revoke all     on function public.delete_own_account() from public;
revoke execute on function public.delete_own_account() from anon;
grant  execute on function public.delete_own_account() to authenticated;
