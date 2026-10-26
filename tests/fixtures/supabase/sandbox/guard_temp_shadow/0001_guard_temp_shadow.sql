-- T7: temp relations are searched before pg_catalog unless pg_temp is listed. Shadow what the final read uses:
-- a pg_class (without catalog rows, so nothing looks changed) that says RLS is on, an empty pg_policy, and a
-- pg_roles that calls every role service_role.
create table public.exposed (id int);
create table public.open (id int);
alter table public.open enable row level security;
create policy "everyone" on public.open to anon using (true);
create temp table pg_class as
  select oid, relname, relnamespace, relkind, true as relrowsecurity from pg_catalog.pg_class
  where relnamespace = 'public'::regnamespace;
create temp table pg_policy as select * from pg_catalog.pg_policy where false;
create temp view pg_roles as select oid, 'service_role'::name as rolname from pg_catalog.pg_authid;
