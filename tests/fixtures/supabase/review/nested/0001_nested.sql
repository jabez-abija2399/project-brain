-- Review H5: nested block comment hides the ALTER TABLE.
/* outer /* inner */ still comment; alter table public.c enable row level security; */
create table public.c (id int);
