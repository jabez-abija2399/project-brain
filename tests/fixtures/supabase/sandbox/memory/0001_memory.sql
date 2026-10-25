-- AC-005-11: a 900 MB string; the memory cap stops it.
create table public.accounts (id int);
alter table public.accounts enable row level security;
select length(repeat('x', 900000000));
