-- T7: the same, with the refusal swallowed by an exception handler.
create table public.exposed (id int);
do $$ begin
  set local session_replication_role = replica;
  update pg_catalog.pg_class set relrowsecurity = true where oid = 'public.exposed'::regclass;
exception when others then null;
end $$;
