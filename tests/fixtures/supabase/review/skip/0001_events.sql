create table public.events (id bigint, created_at date) partition by range (created_at);
alter table public.events enable row level security;
