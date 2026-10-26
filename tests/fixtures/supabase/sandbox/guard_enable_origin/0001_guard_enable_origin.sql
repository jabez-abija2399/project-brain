-- T7: demote the guard from ALWAYS to ORIGIN, write as a replica, then restore ALWAYS.
create table public.exposed (id int);
set allow_system_table_mods = on;
alter table pg_catalog.pg_class enable trigger brain_guard;
set session_replication_role = replica;
update pg_catalog.pg_class set relrowsecurity = true where oid = 'public.exposed'::regclass;
reset session_replication_role;
alter table pg_catalog.pg_class enable always trigger brain_guard;
