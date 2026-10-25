create table public.secrets (id int);
alter table public.secrets enable row level security;
do $$ declare t text := 'secrets'; begin
  execute 'alter table ' || quote_ident(t) || ' disable row level security';
end $$;
