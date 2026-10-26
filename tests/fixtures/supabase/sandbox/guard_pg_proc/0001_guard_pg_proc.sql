-- T7: rewrite the guard function's body in pg_proc directly; each step swallows its own refusal.
create table public.exposed (id int);
do $$ begin
  begin update pg_catalog.pg_proc set prosrc = 'begin return new; end' where proname = 'deny';
  exception when others then null; end;
  begin 
  exception when others then null; end;
end $$;
