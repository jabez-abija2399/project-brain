-- AC-005-10: a failing call could have run any code in Supabase, so every table becomes unknown.
create table public.orders (id int primary key);
alter table public.orders enable row level security;
select cron.schedule('nightly', '0 3 * * *', 'alter table public.orders disable row level security');
create table public.later (id int);
