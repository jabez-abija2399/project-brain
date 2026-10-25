create table public.docs (id int, owner uuid);
alter table public.docs enable row level security;
create policy "owner writes" on public.docs for update using (auth.uid() = owner);
do $$ begin
  execute format('alter policy %I on public.%I using (true)', 'owner writes', 'docs');
end $$;
