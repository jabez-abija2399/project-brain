-- A statement that touches public.a but cannot be parsed: RLS of a becomes unknown, never enabled.
alter table public.a disable row level security,;
-- RLS changed through dynamic SQL in a DO block: not understood, so b is unknown.
do $$ begin execute 'alter table public.b disable row level security'; end $$;
-- An explicit ENABLE after an unreadable statement makes the state known again.
alter table public.c disable row level security,,;
alter table public.c enable row level security;
