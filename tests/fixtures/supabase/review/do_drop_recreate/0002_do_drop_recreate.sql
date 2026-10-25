do $$ begin if exists (select 1 from pg_tables where tablename = 'notes') then drop table public.notes; end if; end $$;
create table public.notes (id int, body text);
