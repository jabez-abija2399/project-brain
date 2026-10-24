# Review FEAT-005: Supabase reader (tables, RLS, policies from SQL migrations)
Date: 2026-10-24 | Base 532f727 .. Head c8418bb (also read 88e8154 code: parser.ts, reader.ts, tokenize.ts, types.ts, db-schema.ts)

## How this was checked
- Ran `pnpm vitest run packages/core/src/supabase/reader.test.ts packages/db/src/repos/db-schema.test.ts`: 6/6 pass.
- Ran `readSupabaseMigrations` (via tsx) on 12 small migration folders in /tmp/feat005-probe/ (script: probe.ts).
  Every finding below quotes the actual output. No source files were changed.
- Scope note: FEAT-015 (AC-015-04) will flag "RLS disabled" and "USING/WITH CHECK (true) on writes" from this output.
  So a wrong `rlsEnabled: true` or a missing/stale policy is a silent security miss downstream.

## HIGH (wrong "RLS enabled" or wrong "safe policy")

H1. Same table name in different schemas is merged; RLS from one schema is reported for the other.
  - parser.ts:52, 67, 85 `stripSchema(...)` drops the schema; reader.ts:48-69 uses the bare name as the map key.
  - Probe `schema`: `create table private.profiles` + `alter table private.profiles enable row level security` +
    `create table public.profiles (id, email)` -> output `[["profiles", true, ["id"]]]`.
    public.profiles really has RLS off and is exposed through the Supabase API; we report it as protected
    (and with the wrong columns). Same for policies: a policy on `storage.objects` is attached to `public.objects`.
  - Fix direction: key tables and policies by `schema.name` (default `public`), keep `schema` in TableSchema/PolicySchema.

H2. One unreadable statement skips the rest of the file, including later RLS changes.
  - reader.ts:42-86: a single try/catch wraps the whole statement loop, so the first throw abandons the file.
  - Probe `skip`: file 1 creates partitioned `public.events` and enables RLS; file 2 has
    `create table public.events_2024 partition of public.events for values ...` (valid PostgreSQL, no column list,
    parser.ts:51 throws) followed by `alter table public.events disable row level security`.
    Output: `[["events", true, ...]]` with one error for 0002.sql. RLS is actually OFF; we report ON.
  - Other valid SQL that also throws and skips the rest of the file: `CREATE TABLE x AS SELECT ...`, `CREATE TABLE x OF type`,
    `E'...\'...'` escape strings (probe `estr`: tokenize.ts:18-35 does not treat `\'` as an escape, so the paren
    matching fails and both tables in the file vanish).
  - AC-005-04 says "other files are still read", which holds, but the remaining statements of the same file are lost.
  - Fix direction: try/catch per statement, record `{file, statement index/line, message}`, continue; treat
    `PARTITION OF` / `AS SELECT` / `OF type` as tables without a column list rather than errors.

H3. DROP TABLE and re-create keeps the old table's RLS flag and columns.
  - reader.ts:48 `if (!tables.has(parsed.name))` keeps the first definition; DROP TABLE is not handled (parser.ts:32-44).
  - Probe `recreate`: 0001 creates `notes` + enables RLS; 0002 `drop table public.notes; create table public.notes (id, body)`.
    Output `[["notes", true, ["id"]]]`. The new table has RLS OFF and a `body` column; we report RLS ON and stale columns.

H4. ALTER POLICY is ignored, so a policy loosened later is still reported as the safe original.
  - parser.ts:32-44 only handles CREATE TABLE / ALTER TABLE / CREATE POLICY.
  - Probe `alterpol`: `create policy "owner writes" ... for update using (auth.uid() = owner)` then
    `alter policy "owner writes" on public.docs using (true)`. Output keeps `using: "auth.uid() = owner"`.
    The table is actually writable by everyone; FEAT-015 would not flag it.

H5. Nested block comments leak commented-out SQL into the parse (PostgreSQL allows nested /* */).
  - tokenize.ts:12-16 ends the comment at the first `*/`.
  - Probe `nested`: `/* outer /* inner */ still comment; alter table public.c enable row level security; */`
    then `create table public.c (id int)`. Output `[["c", true, []]]`: RLS is OFF in the real database, reported ON.

H6. "ENABLE ROW LEVEL SECURITY" is searched anywhere in the ALTER TABLE text, including string literals.
  - parser.ts:68-71 tests the regex against the whole remainder, strings included.
  - Probe `altermulti`: `alter table public.m add column flag text default 'enable row level security'`
    -> `[["m", true, ...]]`. RLS is OFF. Likelihood is low, but per the review brief any false "RLS enabled" is HIGH.
  - Fix direction: match the action list token-wise (outside quotes), e.g. split top-level actions on commas.

## MEDIUM

M1. DROP POLICY is ignored: dropped policies are still reported (false alarms, and wrong policy counts).
  - Probe `droppol`: `create policy "open" ... for update using (true); drop policy "open" on public.t; create policy "own" ...`
    -> both `open` (using "true") and `own` reported. FEAT-015 would flag a policy that no longer exists;
    docs/specs/FEAT-015.md section 5 lists false positives as an abuse case ("teach users to ignore warnings").
    Same root cause as H4: the reader must replay DROP/ALTER POLICY by (schema, table, name).

M2. AS RESTRICTIVE vs PERMISSIVE is parsed and then discarded (parser.ts:93-94; not in ParsedPolicy / PolicySchema).
  - Probe `restrictive`: `create policy "deny" on public.r as restrictive for update using (true)` comes out identical
    to a permissive `using (true)`. A restrictive `true` grants nothing, so FEAT-015 would raise a false
    "allows everyone to write"; conversely FEAT-015 cannot tell that a table with only restrictive policies is closed.
    AC-005-06 requires reading AS RESTRICTIVE; dropping it is a partial pass.

M3. ALTER TABLE ... RENAME TO is ignored: phantom old table plus a column-less new one.
  - Probe `rename`: `create table public.drafts (id)`; `alter table public.drafts rename to posts`;
    `alter table public.posts enable row level security` -> `drafts` (RLS false, columns [id]) and `posts`
    (RLS true, columns []). FEAT-015 would flag a table that no longer exists, and posts loses its columns.
    (Also not handled: `ALTER TABLE ... SET SCHEMA`, and RLS enabled by `EXECUTE` inside DO $$ blocks, which gives a false "disabled".)

## LOW

L1. Test coverage only exercises happy paths for the RLS state machine: no test for DROP/ALTER POLICY, DROP TABLE,
    two schemas, a statement error mid-file, or DISABLE after ENABLE across files. Each HIGH above would be a
    one-file regression test.
L2. Quote scanning is implemented three times (tokenize.ts:18-35, parser.ts:209-226, parser.ts:245-259), and none of them
    handles E'' strings. One shared scanner would fix H2's escape-string case in one place.
L3. parseColumns (parser.ts:160) uses `"[^"]+"` for the first word, so a column named `"a""b"` gets the name `a`.
    The table-name path handles `""` correctly (probe `quotes`).

## Criteria
- AC-005-01..03, 05: satisfied as written (tests pass, DB stores only flags; dbPoliciesRepo.insert checks project ownership
  via the parent table, db_tables has a same-project FK to files).
- AC-005-04: satisfied at file level; see H2 for statements lost within the failing file.
- AC-005-06: fixture passes, but RESTRICTIVE is not represented in the output (M2).
- Security/authz/perf: no issues found in the repo layer; reader is O(file size), no unbounded network or DB work.

VERDICT: FAIL
