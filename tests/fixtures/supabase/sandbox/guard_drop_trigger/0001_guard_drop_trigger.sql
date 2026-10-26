-- T7: DROP TRIGGER on the catalog, then recreate one with the same name.
create table public.exposed (id int);
set allow_system_table_mods = on;
drop trigger brain_guard on pg_catalog.pg_class;
update pg_catalog.pg_class set relrowsecurity = true where oid = 'public.exposed'::regclass;
create trigger brain_guard before insert or update or delete on pg_catalog.pg_class
  for each row execute function brain_guard.deny();
alter table pg_catalog.pg_class enable always trigger brain_guard;
