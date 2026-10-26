# FEAT-005 Supabase reader: tables and RLS policies from SQL migrations

## 1. Intent
Tell the user, for every table their Supabase migrations create, whether row level security is on and which policies
guard it, so FEAT-015 can flag exposed tables. A wrong "RLS enabled" or a wrong "safe policy" is the worst outcome: it
hides an exposed table. When we cannot be sure, the answer is "unknown", never "enabled".
Requirement ids: see agent/features.json. Decision: D-014 (execute the migrations in a sandboxed PGlite).
Non-goals: checking the live Supabase project; running app code; reporting non-table objects (views, functions).

## 2. Flow
1. Caller (CLI index or indexing job) passes the migrations directory and a MigrationSandbox (from @brain/sandbox)
   to readSupabaseMigrations.
2. Files are sorted by name; each is split into statements by libpg-query (per-statement fallback as today).
3. The sandbox starts a child process with PGlite (empty env), creates the Supabase stand-ins, then runs the statements
   one at a time in file order. Each failure is recorded as {file, line, message} and its tables (static reader) become unknown.
4. The sandbox reads tables, columns, relrowsecurity and pg_policies (at most 5,000 of each), and is killed.

Supabase stand-ins (created before any user SQL):
- roles anon, authenticated, service_role;
- schema auth with stub auth.uid() (returns null::uuid) and auth.jwt() (returns '{}'::jsonb), and a table auth.users
  (id, email, phone, role, aud, raw_app_meta_data, raw_user_meta_data, created_at, updated_at): almost every Supabase
  migration references it (`references auth.users`, triggers on auth.users);
- schema storage with tables buckets and objects (RLS enabled, as in Supabase); stand-in tables are reported only
  when user SQL changed their RLS state, policies on them always;
- schema extensions with uuid-ossp and pgcrypto pre-installed from PGlite's bundled extensions (as in Supabase), and
  search_path `"$user", public, extensions`; empty schemas net, vault, cron;
- a catalog guard: BEFORE INSERT/UPDATE/DELETE triggers (ENABLE ALWAYS, so session_replication_role = replica does
  not skip them) on every pg_catalog table except pg_am, pg_amproc, pg_index, pg_opclass and pg_trigger (triggers on
  those overflow PGlite's relcache stack; their built-in rows are checked for changes instead) that raise 42501,
  because migrations run as a superuser in PGlite but as the non-superuser postgres in Supabase (T7). Before raising,
  the guard sends a warning (its own client_min_messages) that the child sees even when an exception handler
  swallows the error: any attempted catalog write makes every table unknown. The guarded database is dumped and reopened before user SQL (triggers on the "nailed"
  catalogs pg_class and pg_authid only load in a new session);
- CREATE EXTENSION [IF NOT EXISTS] for pg_net, supabase_vault, pg_cron, pgsodium, pg_graphql, pg_stat_statements
  and pgjwt is answered as succeeded without running it (measured: an empty schema alone does not make CREATE
  EXTENSION succeed). Later calls into those extensions (net.http_post, cron.schedule, vault.create_secret) fail
  as usual, and their tables become unknown.
5. The result (tables, policies, errors) has the same shape as today; FEAT-015 and the db repo do not change.
   Column types are Postgres' format_type ("timestamp with time zone"). A partition lists its parent's columns.

## 3. Acceptance criteria (mirror agent/features.json)
| ID | Kind | Observable behavior (testable) |
|----|------|--------------------------------|
| AC-005-01 | happy | For tests/fixtures/supabase/migrations, every CREATE TABLE is returned with its columns |
| AC-005-02 | happy | For each table, RLS enabled/disabled and each CREATE POLICY (command, roles, USING/WITH CHECK expression text) is returned |
| AC-005-03 | boundary | A table created in one migration and given RLS in a later migration is reported as RLS enabled |
| AC-005-04 | negative | A migration file that fails to parse is reported in errors[] with its file name; other files are still read |
| AC-005-05 | state | Tables and policies are saved to db_tables and db_policies as flags only; no SQL expression text is stored |
| AC-005-06 | boundary | A realistic migrations fixture is read correctly: $$ function and trigger bodies, comments, schema-qualified and quoted names, lowercase keywords, ALTER TABLE ONLY / IF EXISTS, policies FOR ALL and AS RESTRICTIVE, and RLS enabled in a later file. |
| AC-005-07 | state | Migrations are applied in file order like Postgres: DROP TABLE removes the table and its policies, CREATE TABLE after DROP starts fresh (new columns, RLS off), ALTER TABLE ... RENAME TO / SET SCHEMA moves the table and its policies, DROP POLICY removes the policy, and ALTER POLICY changes only the USING, WITH CHECK or roles it names |
| AC-005-08 | happy | Each policy is reported as permissive or restrictive (AS RESTRICTIVE), and db_policies stores it as a flag; a restrictive policy never counts as allowing everyone (db_policies rejects allows_all = true on a restrictive policy) |
| AC-005-09 | negative | A table touched by a statement that cannot be parsed (syntax error, unterminated string) or followed (dynamic SQL in a DO block that changes RLS or policies) is reported with RLS unknown (rlsUnknown true, rlsEnabled false), never enabled; unparseable statements are in errors[] with file and line, and a later explicit ENABLE/DISABLE makes the state known again |
| AC-005-10 | state | RLS state and policies come from executing the migrations in a sandboxed in-memory Postgres with Supabase stand-ins; a statement that fails marks the tables it touches unknown. (proposed, agent/plan.json) |
| AC-005-11 | attack | A migration with an infinite loop or huge memory use is stopped by the time and memory limits and all tables become unknown. (proposed, agent/plan.json) |
| AC-005-12 | attack | The sandbox process starts with an empty environment, so no secret env vars are reachable from the migrations. (proposed) |
| AC-005-13 | boundary | When the migrations produce more than 5,000 tables or more than 5,000 policies, processing stops and the result is marked unknown. (proposed) |
| AC-005-14 | attack | Postgres error messages in errors[] are cut to 200 characters and secrets in them are masked (first 4 chars + ***). (proposed) |

Regression tests already committed (it.fails until D-014 lands): packages/core/src/supabase/execute.test.ts, one per
review probe (H1 x5, H2 x5, M1, L3), fixtures in tests/fixtures/supabase/review/<probe>/.

## 4. Data and permissions
No schema change: db_tables / db_policies keep flags only (AC-005-05). Policy expression text is the text as written in
the migration when the sandbox proves that statement set it and nothing changed it afterwards (the stored expression
tree, pg_node_tree, changed in that statement and equals the final one); otherwise it is the Postgres deparsed form
(`(auth.uid() = owner)`, one outer pair of parentheses stripped). Measured: deparsing alone would turn
`(select auth.uid()) = id` into `( SELECT auth.uid() AS uid) = id`.
Authorization: the reader has no entry point of its own; callers (CLI, indexing job) call requireProjectAccess() first.

## 5. Threat model: executing untrusted SQL
The migrations come from the user's repository and may be written by an AI agent, copied from the internet, or crafted
by an attacker who controls a repo that is connected to Project Brain. We run that SQL.

Assets: our process memory and env (DATABASE_URL, Claude API key, GitHub App key, better-auth secret); the host
filesystem; our network position (internal endpoints, cloud metadata); availability of the indexing job / CLI; the
correctness of the RLS report (a forged "enabled" hides an exposed table); user source code (D-002, must not be stored).
Actors: a repository owner with malicious migrations; a compromised dependency in the user's project that writes
migrations; an AI agent that writes broken or runaway SQL by accident.
Entry point: the migrations directory read by readSupabaseMigrations (CLI index and the GitHub App indexing job).

Abuse cases and mitigations (each has or gets a test):
| # | Abuse | Mitigation | Test |
|---|-------|------------|------|
| T1 | Infinite loop (`loop end loop`, recursive CTE, `pg_sleep`) ties up the job | Child process SIGKILLed after 30 s total (verify in the FEAT-009 job environment, KI-014) (statement_timeout does not work in PGlite, measured); every table becomes unknown | AC-005-11 |
| T2 | Huge memory use (`repeat()`, string_agg over generate_series) crashes the function | Child runs with `--wasm-max-mem-pages=8192` (512 MB WASM) and `--max-old-space-size`; out-of-memory (SQLSTATE 53200), a crash or a kill makes every table unknown | AC-005-11 |
| T3 | Read host files (`pg_read_file`, `COPY FROM '/etc/...'`, `lo_import`) | PGlite runs on an in-memory virtual filesystem with no host mount (no dataDir); measured on 0.5.10: all three fail, `COPY TO` a host path fails, the virtual root only has /tmp /home /dev /proc /pglite | packages/sandbox runner.test.ts |
| T4 | Run programs (`COPY ... FROM PROGRAM`) | Not possible in WASM. Measured on 0.5.10: the statement is accepted but runs nothing (no file created) and breaks the session ("portal cannot be run"), so the run ends as crash and every table is unknown | same |
| T5 | Network access / SSRF (dblink, postgres_fdw, http, pg_net) | PGlite bundles none of them (0.5.10: dblink, postgres_fdw, http, pg_net, file_fdw all "not available"; only uuid-ossp and pgcrypto are loaded); child gets an empty env, so even an escape has no credentials to send. Node's permission model cannot be used: PGlite calls process.binding, which it blocks (measured, Node 20) | same |
| T6 | Steal our secrets from process memory or env | Untrusted SQL never runs in our process: separate child, `env: {}`, no inherited file descriptors except the IPC channel | AC-005-12 |
| T7 | Forge the result (e.g. a migration writes fake rows that look like catalog output, or creates a table named like a stand-in; or, as superuser, `update pg_class set relrowsecurity = true` inside an exception handler, which Supabase refuses: measured, this forged "enabled" before the guard) | Results come only from pg_catalog joins run by us after the migrations, with every name schema-qualified (user SQL may change search_path); stand-in objects are created before user SQL and reported only when user SQL touched them; the catalog guard (section 2) refuses catalog DML with 42501 like Supabase; any change to the guard's trigger or function rows (disable, drop, replace), or any pg_catalog function, relation, rule, type, operator or cast written by user SQL (`create or replace function pg_catalog.pg_get_expr`, needs allow_system_table_mods), any attempted catalog write (even swallowed), and renaming or replacing the stand-in roles anon/authenticated/service_role make every table unknown; the final read resets all settings, session authorization and role and uses search_path `pg_catalog, pg_temp` so temp tables named pg_class/pg_policy/pg_roles cannot shadow it | core sandbox.test.ts (forge, catalog_dml, guard_tamper, catalog_ddl), guard.test.ts (replica mode, DISABLE/DROP TRIGGER, replaced guard function, pg_trigger/pg_proc DML, TRUNCATE, SECURITY DEFINER, SET/RESET ROLE, temp shadows, role rename) |
| T8 | Lie by failing: a statement that would disable RLS fails on purpose so the earlier "enabled" stays | Failed statements make their tables unknown (static reader), all tables when it cannot tell; never keep "enabled" | AC-005-09, AC-005-10, review M1 |
| T9 | Flood the output (100k tables / policies) to blow up the job or the DB | Cap tables and policies per scan (5 000 each); above the cap, report an error and mark every table unknown | AC-005-13 |
| T10 | Source code leaks into storage/logs via Postgres error messages (`syntax error at or near "<code>"`) | errors[].message keeps only the Postgres message, truncated to 200 chars, secrets masked (first 4 chars + ***), never the statement text; nothing from errors[] is logged with the SQL | AC-005-14 |
| T11 | Escape from WASM into Node via an engine bug | Out of our control; contained by the child process with no env, no secrets and a hard kill; keep PGlite updated within the dependency cooldown (D-013) | none (residual risk) |

Fail-closed rules: any doubt (failed statement, timeout, OOM, child crash, cap exceeded) yields RLS unknown, never enabled;
a restrictive policy never counts as allowing everyone (AC-005-08).
Security pass after implementation: rerun every review probe plus T1-T10; ask "what would an attacker try next?" once more.

## 6. Performance budget
Measured 2026-10-26 on PGlite 0.5.10 / Node 20 (8 cores, local): cold start 3.0-4.4 s; cold start + extensions +
stand-ins + guard + dump and reopen 6-10 s per scan, so the 3 s target below is NOT met (KI-015). 5,000 tables in one
DO block take ~10 s; 5,001 policies on one table with RLS enabled take ~37 s (each CREATE POLICY reloads all of the
table's policies), so that flood ends at the time limit (unknown) rather than at the cap.
Expected input: up to a few hundred migration files, < 5 MB SQL. Targets: PGlite cold start + stand-ins < 3 s; whole
scan < 30 s hard limit (T1). MCP read tools are not affected (they read stored flags only).

## 7. UI contract
No UI in this feature; FEAT-015 shows unknown as "RLS cannot be confirmed" (AC-015-06).

## 8. Observability and errors
Log fields: projectId, file count, statement count, error count, duration, outcome (ok | timeout | oom | crash | capped).
Never log SQL text, expression text or Postgres error messages unmasked.

## 9. Open questions / assumptions
- DECIDED (human, 2026-10-26): the PGlite child-process runner lives in packages/sandbox (@brain/sandbox), usable by
  the CLI; it never imports apps/** or @brain/db* (docs/boundaries.txt). packages/core keeps the orchestration and
  receives the sandbox as an argument (MigrationSandbox); core tests get it through a dev dependency on @brain/sandbox.
  PGlite pinned to 0.5.10 there (docs/dependencies.md); the 0.2.17 measurements in D-014 are repeated on 0.5.10.
- ASSUMPTION: the CLI and the indexing job run on Node with child_process available (Vercel Node runtime, not Edge);
  the child script must be included in the function bundle (outputFileTracingIncludes).
- OPEN: more Supabase stand-ins beyond section 2 (roles supabase_admin, authenticator, supabase_auth_admin; stub
  functions in net, vault, cron; more auth/storage tables) only if real migrations need them; until then those
  statements fail and their tables are unknown.
- DECIDED (human, 2026-10-26): the sandbox loads uuid-ossp and pgcrypto from PGlite's bundled extensions
  (@electric-sql/pglite/contrib/uuid_ossp and /pgcrypto; 0.5.10 bundles both, checked) and pre-installs them in schema
  extensions, so uuid_generate_v4(), gen_random_bytes() and crypt() work (AC-005-10 test). Without them every
  `default uuid_generate_v4()` / `gen_random_bytes()` table failed to create and was unknown.
- MEASURED on 0.5.10 (2026-10-26, Node 20), repeating the 0.2.17 measurements: statement_timeout is still ignored
  (pg_sleep(1) ran 1,002 ms under a 100 ms limit), so the 30 s SIGKILL stays; with `--wasm-max-mem-pages=8192
  --max-old-space-size=256` a 900 MB string fails at once with "out of memory" (53200), peak RSS ~790 MB, versus
  success at ~2.2 GB RSS without the flags; file access as in T3/T4 (COPY FROM PROGRAM changed: no error, session
  broken). A non-superuser session is not possible: PGlite's `username` option only sets current_user, session_user
  stays the superuser, so `set role postgres` escapes (hence the catalog guard, T7).
- KI-014: the time limit and memory flag must be verified in the FEAT-009 job environment before use there.
- OPEN: Node's permission model cannot be used (PGlite calls process.binding, blocked under `--experimental-permission`,
  measured); T5 relies on PGlite having no network code and the empty env.
