-- T7: ALTER TABLE ... DISABLE TRIGGER USER, then switch it back on.
create table public.exposed (id int);
set allow_system_table_mods = on;
alter table pg_catalog.pg_class disable trigger user;
update pg_catalog.pg_class set relrowsecurity = true where oid = 'public.exposed'::regclass;
alter table pg_catalog.pg_class enable trigger user;
