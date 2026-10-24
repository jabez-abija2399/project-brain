-- The first statement is complete and applies; the second never closes its string (rest of the file is lost).
alter table public.d disable row level security;
alter table public.e add column note text default 'never closed
