-- AC-005-14: Postgres error messages quote source; errors[] must cut and mask them.
create table public.accounts (id int);
select * from "token=Zm9vYmFyYmF6cXV4";
do $$ begin raise exception 'password=hunter2hunter2 %', repeat('x', 400); end $$;
