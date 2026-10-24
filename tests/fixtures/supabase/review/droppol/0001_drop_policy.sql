-- Review M1: a dropped policy is gone.
create table public.t (id int, owner uuid);
alter table public.t enable row level security;
create policy "open" on public.t for update using (true);
drop policy "open" on public.t;
create policy "own" on public.t for update using (auth.uid() = owner);
