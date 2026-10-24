-- Review M2: AS RESTRICTIVE is kept; restrictive using (true) grants nothing.
create table public.r (id int);
alter table public.r enable row level security;
create policy "deny" on public.r as restrictive for update using (true);
create policy "allow" on public.r as permissive for select using (true);
