-- T7: catalog DML that Supabase refuses ("postgres" is not a superuser there) must not forge RLS enabled here.
create table public.exposed (id int);
do $$ begin
  update pg_catalog.pg_class set relrowsecurity = true where oid = 'public.exposed'::regclass;
exception when insufficient_privilege then null;
end $$;
