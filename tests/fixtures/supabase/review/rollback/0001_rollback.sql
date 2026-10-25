create table public.x (id int);
begin;
alter table public.x enable row level security;
rollback;
