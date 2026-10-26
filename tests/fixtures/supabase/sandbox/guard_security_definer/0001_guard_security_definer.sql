-- T7: a SECURITY DEFINER function owned by the superuser, with replica mode in its SET clause, called as anon.
create table public.exposed (id int);
create function public.forge() returns void language plpgsql security definer
  set session_replication_role = replica as $$
begin
  update pg_catalog.pg_class set relrowsecurity = true where oid = 'public.exposed'::regclass;
exception when others then null;
end $$;
set role anon;
select public.forge();
reset role;
