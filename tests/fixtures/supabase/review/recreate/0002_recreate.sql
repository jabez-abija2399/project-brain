-- Review H3: dropped and re-created; the new table has RLS off, no policies, and a body column.
drop table public.notes;
create table public.notes (id int, body text);
