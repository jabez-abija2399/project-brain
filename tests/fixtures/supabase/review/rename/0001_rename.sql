-- Review M3: RENAME TO and SET SCHEMA move the table and its policies.
create table public.drafts (id int);
create policy "read drafts" on public.drafts for select using (true);
alter table public.drafts rename to posts;
alter table public.posts enable row level security;
create table public.scratch (id int);
alter table public.scratch set schema private;
