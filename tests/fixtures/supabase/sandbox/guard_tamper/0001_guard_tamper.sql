-- T7: switching off the catalog guard (only a superuser can) makes the whole result unknown.
create table public.exposed (id int);
set allow_system_table_mods = on;
alter table pg_catalog.pg_class disable trigger brain_guard;
update pg_catalog.pg_class set relrowsecurity = true where oid = 'public.exposed'::regclass;
