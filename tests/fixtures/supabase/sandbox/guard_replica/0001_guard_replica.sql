-- T7: session_replication_role = replica skips ordinary triggers; the guard must still refuse catalog DML.
create table public.exposed (id int);
set session_replication_role = replica;
update pg_catalog.pg_class set relrowsecurity = true where oid = 'public.exposed'::regclass;
