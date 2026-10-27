-- AC-005-13: 51 tables, one more than the cap the test injects (50; the default cap is 5,000).
create table public.accounts (id int);
alter table public.accounts enable row level security;
do $$ begin for i in 1..51 loop execute format('create table public.t%s (id int)', i); end loop; end $$;
