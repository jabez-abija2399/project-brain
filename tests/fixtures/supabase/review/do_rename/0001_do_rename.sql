create table public.k (id int);
alter table public.k enable row level security;
do $$ begin alter table public.k rename to k_old; end $$;
create table public.k (id int, extra text);
