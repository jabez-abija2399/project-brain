-- RLS for profiles (created in the previous file).
alter table only public.profiles enable row level security;

create policy "Public profiles are viewable by everyone." on public.profiles
  for select using (true);

create policy "Users can insert their own profile." on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "Users can update own profile." on public.profiles
  as permissive
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No-op if the table were missing; still enables RLS on the quoted table.
alter table if exists "public"."Team Members" enable row level security;

create policy "Members manage team rows" on "public"."Team Members"
  for all
  to authenticated
  using (public.is_team_member(team_id))
  with check (public.is_team_member(team_id));

create policy "Block banned users" on "public"."Team Members"
  as restrictive
  for all
  to authenticated
  using (not exists (select 1 from public.bans b where b.user_id = auth.uid() and b.reason <> 'appeal (pending)'));
