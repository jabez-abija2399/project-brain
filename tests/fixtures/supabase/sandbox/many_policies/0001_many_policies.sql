-- AC-005-13: 51 policies, one more than the cap the test injects (50; the default cap is 5,000). RLS stays off here:
-- with RLS on, every CREATE POLICY reloads all policies of the table (quadratic), which at the default cap hits the
-- 30 s time limit first (also unknown, but not the cap; KI-015).
create table public.accounts (id int);
do $$ begin for i in 1..51 loop execute format('create policy p%s on public.accounts using (false)', i); end loop; end $$;
