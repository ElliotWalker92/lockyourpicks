-- ============================================================
--  Lock Your Picks v2 — profile pictures
-- ============================================================

alter table public.profiles
  add column if not exists avatar_url text;


-- ------------------------------------------------------------
--  Avatar storage
--
--  Public bucket: avatars are shown on the draft board, tables and
--  nav, to anyone who can see those. Making it private would mean
--  signing every URL on every render for no benefit — there is nothing
--  sensitive in a profile picture the league can already see.
--
--  Writes are restricted by path. Files live at avatars/<user_id>/<file>,
--  and the policies below check the first path segment against
--  auth.uid(), so a player can only write inside their own folder. This
--  matters: without it, any signed-in user could overwrite anyone's
--  avatar, or fill the bucket.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,                                     -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


drop policy if exists "avatars: public read"   on storage.objects;
drop policy if exists "avatars: own insert"    on storage.objects;
drop policy if exists "avatars: own update"    on storage.objects;
drop policy if exists "avatars: own delete"    on storage.objects;

create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: own insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars: own update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars: own delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
