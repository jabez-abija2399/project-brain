-- AC-005-13: 5,001 tables, one more than the cap.
create table public.accounts (id int);
alter table public.accounts enable row level security;
do $$ begin for i in 1..5001 loop execute format('create table public.t%s (id int)', i); end loop; end $$;
