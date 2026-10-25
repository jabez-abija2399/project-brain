-- AC-005-13: 5,001 policies, one more than the cap. RLS stays off here: with RLS on, every CREATE POLICY reloads all
-- policies of the table (quadratic), so 5,001 of them hit the 30 s time limit first (also unknown, but not the cap).
create table public.accounts (id int);
do $$ begin for i in 1..5001 loop execute format('create policy p%s on public.accounts using (false)', i); end loop; end $$;
