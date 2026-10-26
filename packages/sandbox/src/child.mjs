// The sandbox child process (D-014): runs untrusted migration SQL in an in-memory PGlite and reports what Postgres
// ended up with. It is started by runner.ts with an empty env and memory caps, and is killed from outside on timeout.
// Plain JavaScript so it runs on Node without a loader. It only answers one job over IPC, then exits.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";

// Supabase stand-ins, created before any user SQL (docs/specs/FEAT-005.md section 2). uuid-ossp and pgcrypto are
// pre-installed in schema extensions and that schema is on the search_path, as in Supabase.
const STAND_INS = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key, email text, phone text, role text, aud text,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, owner uuid, public boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text,
  owner uuid, owner_id text, metadata jsonb, path_tokens text[], version text,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now()
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
create schema extensions;
create schema net;
create schema vault;
create schema cron;
create extension "uuid-ossp" with schema extensions;
create extension pgcrypto with schema extensions;
`;
const SEARCH_PATH = `set search_path to "$user", public, extensions`;

// Migrations run as a superuser here, but as the non-superuser "postgres" in Supabase. A superuser could forge the
// result with catalog DML (update pg_class set relrowsecurity = true) that Supabase refuses. These triggers, on every
// pg_catalog table but UNGUARDED, refuse it the same way (42501). DDL writes the catalogs directly and is not affected. Before
// refusing, the guard sends a warning (its own client_min_messages, so user SQL cannot mute it) that the child sees
// even when user SQL swallows the error: any attempt makes the result unknown. pg_class and pg_authid are "nailed"
// catalogs whose triggers only load in a new session, so the database is dumped and reopened after this.
const GUARD_NOTICE = "brain_guard: catalog write refused";
// Triggers on these overflow the stack of PGlite's relcache (measured on 0.5.10); CATALOG_CHANGED watches their
// built-in rows instead, and GUARD_STATE the guard's own pg_trigger rows.
const UNGUARDED = ["pg_am", "pg_amproc", "pg_index", "pg_opclass", "pg_trigger"];
const GUARDED_FILTER = `relnamespace operator(pg_catalog.=) 'pg_catalog'::pg_catalog.regnamespace
  and relkind operator(pg_catalog.=) 'r'::pg_catalog."char"
  and relname operator(pg_catalog.<>) all ('{${UNGUARDED.join(",")}}'::pg_catalog.name[])`;
const GUARD = `
create schema brain_guard;
create function brain_guard.deny() returns trigger language plpgsql set client_min_messages = warning as $$
begin
  raise warning '${GUARD_NOTICE}';
  raise exception 'permission denied for table %', tg_table_name using errcode = '42501';
end $$;
set allow_system_table_mods = on;
do $$ declare t text; begin
  foreach t in array array(select relname::text from pg_class where ${GUARDED_FILTER}) loop
    execute format('create trigger brain_guard before insert or update or delete on pg_catalog.%I
      for each row execute function brain_guard.deny()', t);
    execute format('alter table pg_catalog.%I enable always trigger brain_guard', t);
  end loop;
end $$;
reset allow_system_table_mods;
`;
// Row versions of the guard objects: any change by user SQL (disable, drop, replace, update) shows up here. The
// stand-in roles are pinned by oid and name, so renaming anon to service_role cannot disguise a policy's roles.
const GUARD_STATE = `select t.tgrelid::pg_catalog.text as name, t.xmin::pg_catalog.text as xmin,
    t.tgenabled::pg_catalog.text as enabled
  from pg_catalog.pg_trigger t where t.tgname operator(pg_catalog.=) 'brain_guard'::pg_catalog.name
  union all
  select p.oid::pg_catalog.text, p.xmin::pg_catalog.text, p.prosrc from pg_catalog.pg_proc p
  where p.pronamespace operator(pg_catalog.=) 'brain_guard'::pg_catalog.regnamespace
  union all
  select r.oid::pg_catalog.text, 'role', r.rolname::pg_catalog.text from pg_catalog.pg_authid r
  where r.rolname operator(pg_catalog.=) any ('{anon,authenticated,service_role}'::pg_catalog.name[])
  order by 1`;
const GUARDED_COUNT = `select pg_catalog.count(*)::pg_catalog.int4 as n from pg_catalog.pg_class
  where ${GUARDED_FILTER}`;
// A superuser may also replace what our final read relies on with DDL, which the guard triggers do not see
// (create or replace function pg_catalog.pg_get_expr ..., or view pg_catalog.pg_roles). Any pg_catalog function,
// relation, rule, type, operator or cast written after the baseline transaction counts as tampering, and so does any
// built-in row (oid below 16384) of the UNGUARDED catalogs.
const CATALOG_CHANGED = `select exists (select from pg_proc where pronamespace = 'pg_catalog'::regnamespace and $1 < xmin::text::int8)
  or exists (select from pg_class where relnamespace = 'pg_catalog'::regnamespace and $1 < xmin::text::int8)
  or exists (select from pg_rewrite r join pg_class c on c.oid = r.ev_class
             where c.relnamespace = 'pg_catalog'::regnamespace and $1 < r.xmin::text::int8)
  or exists (select from pg_type where typnamespace = 'pg_catalog'::regnamespace and $1 < xmin::text::int8)
  or exists (select from pg_operator where oprnamespace = 'pg_catalog'::regnamespace and $1 < xmin::text::int8)
  or exists (select from pg_cast where $1 < xmin::text::int8
             and (select typnamespace from pg_type where oid = castsource) = 'pg_catalog'::regnamespace
             and (select typnamespace from pg_type where oid = casttarget) = 'pg_catalog'::regnamespace)
  or exists (select from pg_am where oid < 16384 and $1 < xmin::text::int8)
  or exists (select from pg_amproc where oid < 16384 and $1 < xmin::text::int8)
  or exists (select from pg_opclass where oid < 16384 and $1 < xmin::text::int8)
  or exists (select from pg_index where indexrelid < 16384 and $1 < xmin::text::int8)
  as changed`;

const REL_FILTER = `c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname !~ '^pg_(toast|temp_)'`;

// Run between user statements, so every name is schema-qualified: user SQL may change search_path or define
// functions and operators that would otherwise shadow the catalog ones.
const COUNTERS = `select pg_catalog.current_setting('search_path') as sp,
  greatest((select pg_catalog.max(oid) from pg_catalog.pg_class),
    (select pg_catalog.max(oid) from pg_catalog.pg_policy))::pg_catalog.text as max_oid,
  (select pg_catalog.count(*)::pg_catalog.int4 from pg_catalog.pg_class c
     where c.relkind operator(pg_catalog.=) 'r'::pg_catalog."char"
        or c.relkind operator(pg_catalog.=) 'p'::pg_catalog."char") as tables,
  (select pg_catalog.count(*)::pg_catalog.int4 from pg_catalog.pg_policy) as policies`;

// The stored expression trees (not the deparsed text, which depends on search_path) of one policy.
const CAPTURE = `select pol.polqual::pg_catalog.text as qual, pol.polwithcheck::pg_catalog.text as chk
  from pg_catalog.pg_policy pol
  join pg_catalog.pg_class c on c.oid operator(pg_catalog.=) pol.polrelid
  join pg_catalog.pg_namespace n on n.oid operator(pg_catalog.=) c.relnamespace
  where n.nspname operator(pg_catalog.=) $1::pg_catalog.name
    and c.relname operator(pg_catalog.=) $2::pg_catalog.name
    and pol.polname operator(pg_catalog.=) $3::pg_catalog.name`;

const TABLES = `select c.oid::text as oid, n.nspname as schema, c.relname as name, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where ${REL_FILTER} order by c.oid limit $1`;

const COLUMNS = `select a.attrelid::text as oid, a.attname as name, format_type(a.atttypid, a.atttypmod) as type
  from pg_attribute a where a.attrelid = any ($1::oid[]) and a.attnum > 0 and not a.attisdropped
  order by a.attrelid, a.attnum`;

const POLICIES = `select pol.oid::text as oid, n.nspname as schema, c.relname as table, pol.polname as name, pol.polpermissive as permissive,
  case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE'
    else 'ALL' end as command,
  case when pol.polroles = '{0}' then array['public']::text[]
    else array(select rolname::text from pg_roles where oid = any (pol.polroles) order by rolname) end as roles,
  pg_get_expr(pol.polqual, pol.polrelid) as using, pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check,
  pol.polqual::text as qual, pol.polwithcheck::text as chk
  from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
  order by pol.oid limit $1`;

process.once("message", (job) => {
  run(job).then(
    (result) => reply({ type: "result", ...result }),
    (err) => reply({ type: "fatal", message: String(err?.message ?? err) }),
  );
});

function reply(message) {
  process.send(message, () => process.exit(0));
}

async function run({ statements, cap }) {
  const extensions = { uuid_ossp, pgcrypto };
  const setup = await PGlite.create({ extensions });
  await setup.exec(STAND_INS + GUARD);
  const image = await setup.dumpDataDir("none");
  await setup.close();
  const db = await PGlite.create({ loadDataDir: image, extensions });
  await db.exec(SEARCH_PATH);
  const guarded = (await db.query(GUARDED_COUNT)).rows[0].n;
  const guard = await guardState(db, guarded);
  const baseline = (await db.query("select pg_catalog.txid_current()::pg_catalog.text as xid"))
    .rows[0].xid;
  const standIns = new Map((await db.query(TABLES, [cap + 1])).rows.map((t) => [t.oid, t.rls]));
  const initial = await counters(db);
  let last = initial;
  let outcome = "ok";
  const steps = [];
  let catalogWrite = false;
  const onNotice = (notice) => {
    if (notice?.message === GUARD_NOTICE) catalogWrite = true;
  };
  for (const st of statements) {
    const before = st.capture ? await capture(db, st.capture) : undefined;
    let error;
    try {
      await db.exec(st.sql, { onNotice });
    } catch (err) {
      // The reader masks and cuts to 200 characters; cut here too so huge messages cannot exhaust the child.
      error = { message: String(err?.message ?? err).slice(0, 1000), code: err?.code };
    }
    const after = st.capture && !error ? await capture(db, st.capture) : undefined;
    last = (await counters(db)) ?? last;
    steps.push({ error, before, after, maxOid: last?.max_oid ?? "0", searchPath: last?.sp ?? "" });
    // Out of memory (SQLSTATE 53200): stop; the catalog is still read, and the reader makes every table unknown.
    if (error?.code === "53200") {
      outcome = "oom";
      break;
    }
    if (last && (last.tables > initial.tables + cap || last.policies > initial.policies + cap)) {
      outcome = "capped";
      break;
    }
  }

  // SAVEPOINT only works inside a transaction block: success means user SQL left one open, 25P02 an aborted one.
  let openTransaction = false;
  try {
    await db.exec("savepoint brain_probe");
    openTransaction = true;
  } catch (err) {
    if (err?.code === "25P02") openTransaction = true;
  }
  if (openTransaction) await db.exec("rollback");
  // pg_temp is searched before pg_catalog for relations unless it is listed: a temp table named pg_class would
  // otherwise answer the reads below.
  await db.exec(
    "reset all; reset session authorization; reset role; set search_path to pg_catalog, pg_temp",
  );
  const tampered =
    guard === undefined ||
    (await guardState(db, guarded)) !== guard ||
    (await catalogChanged(db, baseline));

  const tableRows = (await db.query(TABLES, [cap + standIns.size + 1])).rows.filter(
    (t) => !standIns.has(t.oid) || standIns.get(t.oid) !== t.rls,
  );
  const policyRows = (await db.query(POLICIES, [cap + 1])).rows;
  if (tableRows.length > cap || policyRows.length > cap) outcome = "capped";
  const kept = tableRows.slice(0, cap);
  const columns = new Map();
  for (const c of (await db.query(COLUMNS, [kept.map((t) => t.oid)])).rows) {
    const list = columns.get(c.oid) ?? [];
    list.push({ name: c.name, type: c.type });
    columns.set(c.oid, list);
  }
  const tables = kept.map((t) => ({
    oid: t.oid,
    schema: t.schema,
    name: t.name,
    rlsEnabled: t.rls,
    columns: columns.get(t.oid) ?? [],
  }));
  const policies = policyRows.slice(0, cap).map((p) => ({
    oid: p.oid,
    schema: p.schema,
    table: p.table,
    name: p.name,
    command: p.command,
    roles: p.roles,
    permissive: p.permissive,
    using: p.using,
    withCheck: p.with_check,
    trees: { qual: p.qual, withCheck: p.chk },
  }));
  return {
    outcome,
    maxOid: initial.max_oid,
    searchPath: initial.sp,
    openTransaction,
    tampered,
    catalogWrite,
    steps,
    tables,
    policies,
    childEnvKeys: Object.keys(process.env),
  };
}

async function catalogChanged(db, baseline) {
  try {
    return (await db.query(CATALOG_CHANGED, [baseline])).rows[0].changed === true;
  } catch {
    return true;
  }
}

// One trigger per guarded catalog, the guard function and the three stand-in roles.
async function guardState(db, guarded) {
  try {
    const rows = (await db.query(GUARD_STATE)).rows;
    return rows.length === guarded + 4 ? JSON.stringify(rows) : undefined;
  } catch {
    return undefined; // e.g. schema brain_guard dropped
  }
}

async function counters(db) {
  try {
    return (await db.query(COUNTERS)).rows[0];
  } catch {
    return undefined; // e.g. inside an aborted transaction
  }
}

async function capture(db, key) {
  try {
    const row = (await db.query(CAPTURE, [key.schema, key.table, key.name])).rows[0];
    return row ? { qual: row.qual, withCheck: row.chk } : null;
  } catch {
    return undefined; // unknown: the reader then shows the catalog text
  }
}
