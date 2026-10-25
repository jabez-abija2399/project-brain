-- AC-005-10: a statement that fails in the sandbox marks only the table it touches unknown.
create table public.orders (id int primary key);
alter table public.orders enable row level security;
create table public.items (id int primary key);
alter table public.items enable row level security;
alter table public.orders add column vendor_id int references private.vendors (id);
