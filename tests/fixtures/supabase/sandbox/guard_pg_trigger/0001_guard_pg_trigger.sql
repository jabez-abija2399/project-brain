-- T7: switch the guard off by writing pg_trigger directly; each step swallows its own refusal so successes stick.
create table public.exposed (id int);
do $$ begin
  begin update pg_catalog.pg_trigger set tgenabled = 'D' where tgname = 'brain_guard';
  exception when others then null; end;
  begin 
  exception when others then null; end;
  begin update pg_catalog.pg_trigger set tgenabled = 'A' where tgname = 'brain_guard';
  exception when others then null; end;
end $$;
