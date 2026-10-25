create table public.secrets (id int);
alter table public.secrets enable row level security;
create function public.open_up() returns void language plpgsql as $$
begin alter table public.secrets disable row level security; end $$;
select public.open_up();
