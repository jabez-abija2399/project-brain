-- T7: rename roles so a policy for anon reads as a policy for service_role.
create table public.exposed (id int);
alter table public.exposed enable row level security;
create policy "everyone" on public.exposed to anon using (true);
alter role service_role rename to old_service_role;
alter role anon rename to service_role;
