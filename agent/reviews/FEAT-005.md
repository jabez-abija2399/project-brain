# Review FEAT-005: Supabase reader (re-review after the libpg-query + replay.ts rewrite)
Date: 2026-10-26 | Head db4c5df | Code read: packages/core/src/supabase/{parser,replay,reader,tokenize,types}.ts,
replay.test.ts, reader.test.ts, tests/fixtures/supabase/review/unknown/*

## How this was checked
- `pnpm vitest run packages/core/src/supabase packages/db/src/repos/db-schema.test.ts`: 3 files, 17/17 pass.
- Re-created the probes from the 2026-10-24 review plus 21 new ones in /tmp/feat005-probe2/cases{,2}/ and ran
  `readSupabaseMigrations` on each (probe.mts, via tsx). Output is quoted as `table -> ON/off/UNKNOWN`. No source files were changed.
- Question asked: can any probe still give a false "RLS enabled" or a false "safe policy"? **Yes, see H1 and H2.**

## Previous probes: all fixed
| Old finding | Probe | Now |
|---|---|---|
| H1 schemas merged | schema | private.profiles ON, public.profiles off (cols id, email) |
| H2 rest of file skipped | skip, estr | events off; partition table read; E'it\'s' is fine, a off, b ON |
| H3 DROP + re-create | recreate | notes off, cols [id, body] |
| H4 ALTER POLICY | alterpol | using "true" (FEAT-015 can flag it) |
| H5 nested comments | nested | c off |
| H6 RLS text in a string | altermulti | m off |
| M1 DROP POLICY | droppol | only "own" left |
| M2 RESTRICTIVE | restrictive, permissive_default | RESTR / perm right; default and AS PERMISSIVE are perm |
| M3 RENAME / SET SCHEMA | rename, setschema | posts ON with its columns; private.s ON, new public.s off |
| DO EXECUTE with a literal name | doexec | d UNKNOWN |
| L3 `"a""b"` columns | quotes | column `a"b` |

## HIGH (false "RLS enabled" / false "safe policy")

H1. Dynamic SQL in a DO block that names its table through a variable keeps the table "RLS enabled". This breaks AC-005-09.
  - tokenize.ts:62-80 `relationsNamedIn`: when the name after `TABLE`/`ON` is only partly literal, it still returns a
    made-up relation. (a) `public.%I`: it stops at `%` and pushes `{public, public}`. (b) `'alter table ' || quote_ident(t) || ' disable ...'`:
    the next token across the string pieces is the unreserved keyword `disable`, which `isIdent` (line 133) accepts.
    `relationsInCodeBody` (line 96) then returns a non-empty list instead of `null`, so `markUnknown` changes only the
    made-up table and leaves the real one alone.
  - Ran `relationsInCodeBody` directly: case (a) gives `[{"schema":"public","name":"public"}]` and case (b) gives `[{"schema":"public","name":"disable"}]`.
  - Probe `do_fmt_schema`: `alter table public.secrets enable rls` and then the common loop
    `for t in select tablename from pg_tables ... execute format('alter table public.%I disable row level security', t)`
    -> `public.secrets -> ON`. RLS is actually OFF on every public table.
  - Probe `do_concat`: `execute 'alter table ' || quote_ident(t) || ' disable row level security'` -> `secrets -> ON`.
  - False safe policy: in probe `pol_do_fmt`, `execute format('alter policy %I on public.%I using (true)', 'owner writes', 'docs')`
    gives `docs -> ON` and the policy still shows `using "auth.uid() = owner"`. In probe `pol_do_concat`
    (`... on public.' || quote_ident(t) || ' using (true)'`) the output is the same. The real policy is `USING (true)` on UPDATE, so anyone can write to the table.
  - Probe `comment_in_do`: `'... disable row ' || 'level security'` splits the words, so the regex at parser.ts:233 misses
    them and the block is ignored (`c2 -> ON`). This is unlikely in practice, but the cause is the same: the code decides from the text that the block is harmless.
  - Fix direction: a name only counts when every part is a complete identifier and the next token cannot continue
    the name (not `.`, `%`, `||` or the end of a string piece). Otherwise return `null` (all tables unknown). For a DO block that
    contains EXECUTE, a safer choice is to always return `null`.

H2. A statement the replay does not recognize has no effect, so tables that are changed out of sight keep their earlier "enabled" state.
  - parser.ts:107-118 returns `null` for every other node type and reader.ts:67 skips it. Only DO blocks whose text
    matches a regex become "unknown". Each probe below is valid PostgreSQL that the reader reports as RLS ON while the real table has RLS OFF:
    - `func_call`: `create function public.open_up() ... $$ begin alter table public.secrets disable row level security; end $$;`
      `select public.open_up();` -> `secrets -> ON`. Function bodies are never examined, and SELECT/CALL are ignored.
    - `drop_schema`: 0002 `drop schema public cascade; create schema public; create table public.notes (id, body)`
      -> `notes -> ON`, cols `[id]`, and the old policy `own using (true)` is still listed. DROP SCHEMA is not replayed, so the
      new CREATE TABLE hits "keep the first" (replay.ts:27). Resetting `public` this way is a known pattern.
    - `do_drop_recreate`: `do $$ begin if exists (...) then drop table public.notes; end if; end $$;` plus
      `create table public.notes (id, body)` -> `notes -> ON`, cols `[id]`. A static DROP inside a DO block is not "RLS text", so it is ignored.
    - `do_rename`: `do $$ begin alter table public.k rename to k_old; end $$; create table public.k (...)` -> `k -> ON`.
    - `search_path`: `set search_path to app; create table profiles ...; alter table profiles enable rls` -> the
      existing `public.profiles -> ON`. parser.ts:240 always resolves unqualified names to `public`.
  - The replay fails open: when it cannot follow a statement, it keeps the previous state. AC-005-09's principle
    ("never enabled" when a statement cannot be followed) is only applied to parse errors and to DO blocks that mention RLS.
  - Fix direction: fail closed. (1) DROP SCHEMA x [CASCADE]: drop tables and policies in x. (2) A DO block, or a SELECT/CALL
    of a function defined in the migrations, whose body contains DDL (ALTER/DROP/CREATE ... TABLE/POLICY): mark its tables unknown, or all
    tables when it cannot tell. (3) After a SET search_path / set_config('search_path') to anything except public, mark unqualified names unknown.

## MEDIUM

M1. When an unterminated string swallows the rest of the file, the tables named in that text are not marked unknown.
  - reader.ts:120-128 adds the cut-off tail with `tables: []`.
  - Probe `unterminated2`: `alter table public.u enable rls;` then `select 'oops; alter table public.u disable row level security;`
    -> `u -> ON` with an error at line 3. AC-005-09 lists "unterminated string" as a statement that cannot be parsed,
    and the swallowed text clearly touches `u`. Whatever version of this file was really deployed, its effect on `u` is unknown.
    The 0003_unterminated fixture only covers the case where the cut happens inside the statement that names the table.
  - Fix direction: run `relationsNamedIn` on the tokens of the tail text (or use `null`) instead of `[]`.

## LOW

L1. The AC-005-09 test (replay.test.ts:61, fixture review/unknown/0002) only uses a literal table name inside EXECUTE.
    There is no case for `format('%I')`, `public.%I`, string concatenation, a function call, or DROP SCHEMA. Each of H1, H2 and M1 above can be a one-file regression fixture.
L2. A valid PG14+ `create function f() ... begin atomic select 1; select 2; end;` is reported as a parse error when another
    statement in the same file fails. The cause is that the per-statement fallback splits at every top-level `;` (tokenize.ts:40), so a valid file gets a false error.
    Probe `atomic`: errors at line 3 ("syntax error at end of input") and line 5. RLS output is still right (`q -> off`).
L3. `begin; alter table public.x enable row level security; rollback;` -> `x -> ON` (probe `rollback`). This is unusual in migrations,
    but it is another false "enabled". Ignoring statements between BEGIN and ROLLBACK would fix it.

## Criteria
- AC-005-01..06, 08: satisfied. Probes and tests agree, and the DB check constraints keep `NOT (rls_enabled AND rls_unknown)`
  and `permissive OR NOT allows_all`.
- AC-005-07: satisfied as written (DROP/RENAME/SET SCHEMA/DROP and ALTER POLICY all replay correctly). DROP SCHEMA is not covered (H2).
- AC-005-09: **not satisfied.** Dynamic SQL in a DO block that changes RLS or policies through `format('...public.%I')` or `||` keeps
  the table "enabled" (H1). The unterminated-string tail also does not make the tables it names unknown (M1).
- Security/architecture/perf: packages/core stays pure (libpg-query is WASM, no I/O except reading the migrations dir).
  The repo layer has not changed since the last review. Per-statement fallback filters every token for every chunk
  (reader.ts:103), which is O(n²) on a large broken file. That is acceptable for migration sizes, so it is not a finding.

VERDICT: FAIL
