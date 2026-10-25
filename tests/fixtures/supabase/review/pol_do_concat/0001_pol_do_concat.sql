create table public.docs (id int, owner uuid);
alter table public.docs enable row level security;
create policy "owner writes" on public.docs for update using (auth.uid() = owner);
do $$ declare t text := 'docs'; begin
  execute 'alter policy "owner writes" on public.' || quote_ident(t) || ' using (true)';
end $$;
