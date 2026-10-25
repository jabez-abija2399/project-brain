-- T7: objects named like the catalog do not change what the reader sees.
create table public.exposed (id int);
create view public.pg_policies as
  select 'public'::name as schemaname, 'exposed'::name as tablename, 'fake'::name as policyname;
create table public.pg_class (oid oid, relname name, relrowsecurity boolean);
insert into public.pg_class values (1, 'exposed', true);
create function public.format_type(oid, integer) returns text language sql as $$ select 'forged' $$;
set search_path = public, pg_catalog;
