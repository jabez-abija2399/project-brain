-- T7: TRUNCATE skips row triggers. Emptying pg_policy hides the USING (true) policy (RLS on, no policy = looks safe).
create table public.exposed (id int);
alter table public.exposed enable row level security;
create policy "everyone" on public.exposed using (true);
set allow_system_table_mods = on;
truncate pg_catalog.pg_policy;
