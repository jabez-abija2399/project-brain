-- Review H6: the RLS words inside a string literal are not an RLS command.
create table public.m (id int);
alter table public.m add column flag text default 'enable row level security';
create table public.n (id int);
alter table public.n add column x int, enable row level security;
