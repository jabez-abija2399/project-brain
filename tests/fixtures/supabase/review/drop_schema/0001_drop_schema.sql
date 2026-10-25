create table public.notes (id int);
alter table public.notes enable row level security;
create policy "own" on public.notes for select using (true);
