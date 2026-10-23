# Review: FEAT-002 Database schema, migrations and project-scoped repositories

Requested focus: repository scoping by projectId, cascade deletes, and whether migrations are safe to run twice on real Postgres (Neon), not only PGlite.

Files read: packages/db/migrations/0000_init.sql, 0001_auth.sql, src/migrate.mjs, src/migrations.ts, src/testing.ts,
src/db.ts, src/index.ts, src/schema.ts (FK lines), src/repos/*.ts, src/migrations.test.ts, src/repos/repos.test.ts.

Evidence runs: a scratch vitest file kept outside the repo (/tmp/rev2/review.test.ts), run against the real packages/db
modules with `npx vitest run --root /tmp/rev2 --config /dev/null`. No repo files were changed.

## HIGH
None.

## MEDIUM

### M1. Repositories accept child ids from another project (cross-project references, cross-project cascade)
- Where: packages/db/src/repos/symbols.ts:6-16 (`fileId` taken from `data`), db-schema.ts:13-24 (`fileId`),
  requests.ts:6-16 (`featureId`), receipts.ts:6-16 (`requestId`). The schema has single-column FKs
  (0000_init.sql:34, 84, 101, 111; also feature_files:56-57), so nothing ties the referenced row to the same `project_id`.
- What I ran: created projects A (owner a) and B (owner b) and a file `fB` in B. Then I called
  `symbolsRepo.insert(db, A.id, { fileId: fB.id, ... })` and `dbTablesRepo.insert(db, A.id, { fileId: fB.id, ... })`.
  Both succeeded (`CROSS symbol inserted true true`, `CROSS db_table inserted true`).
- Then `projectsRepo.delete(db, B.id, "b")` deleted project A's symbol: `A symbols after deleting B: 0`.
  So one owner deleting their project destroys another owner's data. A row in A can also point at B's file metadata.
- Why it matters: AC-002-04's intent is project isolation, and the project rule says never to trust ids from the
  client. Once the upload/index endpoint (FEAT-008) passes a client-supplied `fileId` or `featureId`, this becomes an
  IDOR/integrity hole. The tests only cover the read side (`list` filtered by project), not writes with foreign ids.
- Fix: add composite FKs, for example `UNIQUE (project_id, id)` on files, features and requests, plus
  `FOREIGN KEY (project_id, file_id) REFERENCES files(project_id, id) ON DELETE CASCADE`. Alternatively, check
  ownership inside the repo. Add a negative test that the foreign-id insert is rejected.

### M2. AC-002-04 "every repository read/write function requires a projectId" is not met
- packages/db/src/repos/db-schema.ts:41 `dbPoliciesRepo.insert(db, data)` and :47 `listForTable(db, tableId)` take no
  projectId. A caller holding any `tableId` reads another project's policies. `db_policies` has no `project_id` column
  (0000_init.sql:117-123), so the repo cannot scope it.
- packages/db/src/repos/project-tokens.ts:59 `touchLastUsed(db, tokenId)` is also unscoped. `findActiveByValue` at :49
  is a reasonable exception, because the lookup is by secret.
- No test enumerates the repo functions, so the AC test (repos.test.ts, symbols only) cannot catch this.
- Fix: scope through a join on `db_tables.project_id` (or add the column) and pass projectId. Optionally add a test that
  checks every exported repo function's arity or signature.

### M3. The command in AC-002-01/02 (`pnpm --filter @brain/db migrate` → src/migrate.mjs) is never tested; tests exercise a duplicate runner
- AC-002-01 and AC-002-02 in migrations.test.ts call `runMigrations` from src/migrations.ts:25-40. Production and
  scripts/dev.sh:24 run src/migrate.mjs, a separate copy of the same logic (`grep -rn migrate.mjs` finds no test).
- The two copies already differ: migrate.mjs:31-34 wraps each file plus its tracking insert in `sql.begin`, while
  migrations.ts:36-37 does not. A fix to one will silently not reach the other.
- So "migrate twice is a no-op and exits 0" has only been verified for the PGlite in-process path. Nothing checks
  postgres.js against a wire-protocol server (Neon) or the exit code.
- My attempt: I ran migrate.mjs twice via `servePgliteOverTcp`. Run 1 hung until killed (SIGTERM at 15 s). Run 2 exited 1
  with `42P07 relation "projects" already exists`. I attribute this to the shim: PGlite is a single session and the
  killed client's open transaction was never rolled back. So I am **not** claiming migrate.mjs is broken on Neon. On
  reading, sequential runs look idempotent. The point is that no test can currently show it either way.
- Fix: make migrate.mjs a thin wrapper around `runMigrations` with a postgres.js driver (one code path). Then add a test
  that spawns the real command against a wire-protocol Postgres and asserts exit 0 twice, plus a manual run against the
  Neon dev branch recorded as evidence.

## LOW

### L1. No lock against concurrent migrate runs
migrate.mjs:23-35 reads `_brain_migrations` and then applies files with no `pg_advisory_lock`. Scenario: two Vercel
deploys or a dev and CI run start together. Both see an empty set, the second fails on `CREATE TABLE` (42P07) or on the
tracking PK and exits 1. That fails a deploy but does not corrupt data, thanks to the per-file transaction. Fix:
`SELECT pg_advisory_lock(<const>)` at the start.

### L2. AC-002-05 test omits some project-owned tables
repos.test.ts:190-198 counts projects/files/symbols/features/agent_sessions/requests/receipts, which matches the AC.
It does not count decisions, feature_files, checklist_items, project_tokens, db_tables or db_policies, although they also
cascade per 0000_init.sql. A future migration that drops a CASCADE there would go unnoticed.

## Checked and OK
- Every project-owned table in 0000_init.sql has `project_id … REFERENCES projects(id) ON DELETE CASCADE` and an index.
  `projects.owner_id` cascades from `user` (0001_auth.sql:56-58). schema.ts FK `onDelete` values match the SQL.
- AC-002-03: `files_project_path_uniq` exists and the test asserts the unique error.
- projectsRepo get/rename/delete are scoped by both projectId and ownerId. Read repos all filter on `project_id`.
- Sequential reruns: the tracking table plus a per-file transaction in migrate.mjs means a second run skips everything.
  Migration SQL has no PGlite-only syntax.

VERDICT: FAIL
