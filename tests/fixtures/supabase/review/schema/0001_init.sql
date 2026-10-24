-- Review H1: same table name in two schemas; RLS only on private.profiles.
create table private.profiles (id uuid primary key);
alter table private.profiles enable row level security;

create table public.profiles (id uuid primary key, email text);

create policy "own files" on storage.objects for select to authenticated using (owner = auth.uid());
