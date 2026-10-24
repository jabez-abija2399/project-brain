-- Review H4: a safe policy loosened later by ALTER POLICY.
create table public.docs (id int, owner uuid);
alter table public.docs enable row level security;
create policy "owner writes" on public.docs for update to authenticated using (auth.uid() = owner) with check (auth.uid() = owner);
alter policy "owner writes" on public.docs using (true);
