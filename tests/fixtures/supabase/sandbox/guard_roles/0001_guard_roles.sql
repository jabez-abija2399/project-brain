-- T7: SET ROLE / RESET ROLE / SET SESSION AUTHORIZATION around a swallowed catalog write; the session is left as anon.
create table public.exposed (id int);
create role evil superuser;
set session authorization evil;
set role anon;
do $$ begin
  reset role;
  update pg_catalog.pg_class set relrowsecurity = true where oid = 'public.exposed'::regclass;
exception when others then null;
end $$;
set session authorization anon;
