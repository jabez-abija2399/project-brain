create table public.u (id int);
alter table public.u enable row level security;
select 'oops; alter table public.u disable row level security;
