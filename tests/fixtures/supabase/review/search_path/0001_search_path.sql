create table public.profiles (id int);
create schema app;
set search_path to app;
create table profiles (id int);
alter table profiles enable row level security;
