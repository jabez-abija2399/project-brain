create table public.c2 (id int);
alter table public.c2 enable row level security;
do $$ begin execute 'alter table public.c2 ' || 'disable row ' || 'level security'; end $$;
