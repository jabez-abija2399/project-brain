-- AC-005-10: Supabase objects the stand-ins provide; every statement succeeds.
create extension if not exists pg_net;
create extension if not exists pg_cron with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users on delete cascade,
  api_salt bytea default gen_random_bytes(16),
  pin_hash text default crypt('0000', gen_salt('bf'))
);
alter table public.profiles enable row level security;
grant select on public.profiles to anon, authenticated, service_role;
create policy "own profile" on public.profiles for select to authenticated using (auth.uid() = user_id);
create policy "admins" on public.profiles for all to authenticated
  using ((auth.jwt() ->> 'role') = 'admin') with check ((auth.jwt() ->> 'role') = 'admin');

insert into storage.buckets (id, name) values ('avatars', 'avatars');
create policy "avatar uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and owner = auth.uid());

create table public.notes (id uuid primary key default gen_random_uuid(), body text);
