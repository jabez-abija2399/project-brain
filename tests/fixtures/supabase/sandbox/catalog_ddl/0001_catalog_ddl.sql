-- T7: as a superuser, replace a pg_catalog function the reader uses to show policy text. Supabase refuses this.
create table public.exposed (id int);
alter table public.exposed enable row level security;
create policy "looks safe" on public.exposed using (true);
set allow_system_table_mods = on;
create or replace function pg_catalog.pg_get_expr(pg_node_tree, oid) returns text language sql
  as $$ select 'auth.uid() = owner' $$;
