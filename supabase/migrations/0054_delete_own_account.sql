-- ============================================================
--  Deleting your own account
--
--  Every gameplay table references auth.users with `on delete
--  cascade`, so removing that row is not an option. It would take the
--  player's picks and gameweek_scores with it, and a division is three
--  people whose season only adds up if all three are still there --
--  one deletion would silently rewrite two other people's history.
--  Worse, leagues.owner_id cascades too: an owner leaving would
--  destroy the league, its divisions, its drafts and every other
--  member's record of them.
--
--  So the row stays and the person is taken out of it. Afterwards
--  there is no name, no email, no password and no way back in, and the
--  picks that remain are attached to nothing anyone can identify --
--  which is what the privacy policy already promises.
--
--  The function takes no arguments on purpose. It acts on auth.uid()
--  and nothing else, so there is no shape of call that deletes
--  somebody else's account.
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

  -- The profile row stays, because the draft board and the tables join
  -- to it for a name. What is left in it is a placeholder.
  update public.profiles
     set display_name = 'Deleted player',
         email        = null,
         avatar_url   = null,
         avatar_color = '#c8f135',
         updated_at   = now()
   where id = uid;

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
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

comment on function public.delete_own_account() is
  'Anonymises the calling user: scrubs the auth row, blanks the profile, '
  'hands on or removes any league they own, and leaves their picks in '
  'place attached to nobody. Not reversible.';
