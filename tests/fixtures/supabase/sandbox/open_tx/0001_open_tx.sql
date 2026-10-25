-- A transaction left open at the end: a later COMMIT or ROLLBACK would decide, so RLS cannot be confirmed.
create table public.accounts (id int);
alter table public.accounts enable row level security;
begin;
alter table public.accounts disable row level security;
