-- AC-005-11: an infinite loop; only the time limit stops it.
create table public.accounts (id int);
alter table public.accounts enable row level security;
do $$ begin loop end loop; end $$;
