-- Review H2: valid statements the old reader could not read, then later RLS changes in the same file.
create table public.events_2024 partition of public.events
  for values from ('2024-01-01') to ('2025-01-01');
alter table public.events disable row level security;

create table public.events_copy as select * from public.events;
create table public.notes (note text default E'it\'s (here'); create table public.tags (id int);

-- A statement that really is broken (line 10); the next one must still be read.
create table public.broken (id int,;
alter table public.tags enable row level security;
