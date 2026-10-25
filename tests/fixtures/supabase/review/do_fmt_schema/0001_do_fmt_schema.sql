create table public.secrets (id int);
alter table public.secrets enable row level security;
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I disable row level security', t);
  end loop;
end $$;
