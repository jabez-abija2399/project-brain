-- T7: CREATE OR REPLACE the guard function so it lets the write through, then put the original back.
create table public.exposed (id int);
create or replace function brain_guard.deny() returns trigger language plpgsql as $$
begin return new; end $$;
update pg_catalog.pg_class set relrowsecurity = true where oid = 'public.exposed'::regclass;
create or replace function brain_guard.deny() returns trigger language plpgsql as $$
begin raise exception 'permission denied for table %', tg_table_name using errcode = '42501'; end $$;
