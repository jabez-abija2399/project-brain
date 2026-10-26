-- T7: ALTER TABLE ... DISABLE TRIGGER ALL on a catalog (superuser with allow_system_table_mods).
create table public.exposed (id int);
set allow_system_table_mods = on;
alter table pg_catalog.pg_class disable trigger all;
update pg_catalog.pg_class set relrowsecurity = true where oid = 'public.exposed'::regclass;
alter table pg_catalog.pg_class enable trigger all;
