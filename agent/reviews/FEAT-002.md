# Review: FEAT-002 Database schema, migrations and project-scoped repositories

Date: 2026-10-24 · Base d62587cffc4d · Head 5988a896c5f3
Scope: packages/db (migrations 0000–0003, migrate.mjs, migrations-core.mjs, repos/*, schema/*, testing.ts) and their tests.

## What I ran
- `pnpm --filter @brain/db test`: 6 files, 18 tests, all PASS.
- `pnpm vitest run packages/db` (the AGENTS.md single-test command, run from the repo root): 2 FAIL, both 5 s timeouts (see L7).
- PGlite experiments with all 4 migrations applied, scripts in /tmp/rv002/ (explain.mjs, sym.mjs), outside the repo.

## Criteria
- AC-002-01: satisfied. migrations.test.ts:47 checks all 17 tables (the doc's users/sessions map to better-auth `user`/`session`).
- AC-002-02: satisfied. In-process run and real `node src/migrate.mjs` over the wire, twice, exit 0, second run "no new migrations" (migrations.test.ts:60, :71). Advisory lock plus a re-check under the lock is sound.
- AC-002-03: satisfied (migrations.test.ts:113, `files_project_path_uniq`).
- AC-002-04: satisfied for the project-scoped tables. Composite same-project FKs (0002, 0003) are enforced at the DB level and tested with raw SQL (repos.test.ts:338). Exceptions are in L1.
- AC-002-05: satisfied. repos.test.ts:208 counts 0 rows in every child table, including link tables and db_policies, and checks that project B is untouched.

## HIGH
None.

## MEDIUM

### M1. symbols has no index on (project_id, file_id): every file delete scans all of the project's symbols
- Where: migrations/0002_same_project_refs.sql:191-194 adds FK `symbols(project_id, file_id) → files(project_id, id) ON DELETE CASCADE`. The only indexes are `symbols_project_idx` and `symbols_project_kind_name_idx` (0000_init.sql:41-42), and neither has file_id after project_id. `symbolsRepo.deleteByFile` (repos/symbols.ts:33) uses the same predicate.
- Evidence (/tmp/rv002/sym.mjs, 1 project, 2,000 files, 40,000 symbols):
  `EXPLAIN DELETE FROM symbols WHERE project_id='p1' AND file_id='f1'` → `Index Scan using symbols_project_idx … Filter: (file_id = 'f1')`.
  Deleting 500 files took **4,911 ms**. With `CREATE INDEX ON symbols(project_id, file_id)` the same delete took **36 ms** (136× faster).
- Scenario: a re-index that drops or replaces files, a deleteByFile loop, or a project delete costs O(files × project symbols). Mid-size repos will exceed the 2 s webhook/job budget. `db_tables` (0002:196-199) has the same pattern at lower volume.

### M2. feature_files has no index usable by its file FK: every file delete scans feature_files across all tenants
- Where: 0003_link_tables_project_id.sql:229-231, FK `(project_id, file_id) → files`. The only index on feature_files is the PK `(feature_id, file_id)` (0000_init.sql:58), so file_id is not a leading column. There is no project_id index either, although docs/architecture.md (Data model) says "Indexes: every table on project_id".
- Evidence (/tmp/rv002/explain.mjs, 50 projects, 20,000 files, 20,000 feature_files):
  the plan is `Index Scan using feature_files_pkey … Index Cond: (file_id='f1') Filter: (project_id='p2')`, a full walk of the PK index with cost 694.
  Deleting one project's 400 files took **527 ms**. With an index on `(project_id, file_id)` it took **19 ms** (28×).
- Scenario: the cost grows with the total number of feature_files rows across all customers, not just the caller's project. One tenant's re-index slows down as the platform grows.

## LOW

- L1. Not every repository function takes a projectId, as AC-002-04 literally requires:
  - `projectTokensRepo.findActiveByValue` (repos/project-tokens.ts:49) looks tokens up by hash only. This is justified, since it is the token-auth entry point and its only caller is apps/web/src/server/tokens.ts:9.
  - `projectsRepo.*` is owner-scoped. `usersRepo.*` is unscoped.
  
  Nothing checks the rule structurally, for example a test that walks repo exports and checks the second parameter, so a future unscoped function would slip in. The exceptions should be documented.
- L2. The docs promise `summary<=200`, but neither the DB nor the repo enforces it. `symbols.summary` is plain `text` (0000_init.sql:38), and `symbolsRepo.insert` stores any length. Only the indexer truncates (packages/core/src/indexer/parser.ts:95). Any other writer, such as a future CLI upload, could store long text and work against the "no source code in DB" rule. A `CHECK (char_length(summary) <= 200)` or a repo guard would close this.
- L3. These list functions have no limit: `filesRepo.list` (files.ts:28), `symbolsRepo.list` (symbols.ts:19), `featuresRepo.list` and `dbTablesRepo.list`. MCP reads have a p95 < 500 ms budget, and a large project will return tens of thousands of rows. `receipts` and `requests` already have a limit.
- L4. `migrate.mjs:6-9` exits 0 with "skipping" when DATABASE_URL is unset. A deploy with a missing env var reports success without migrating.
- L5. Redundant indexes add write cost on the hottest tables:
  - `symbols_project_idx` is a prefix of `symbols_project_kind_name_idx`.
  - `files_project_idx` is a prefix of both `files_project_path_uniq` and `files_project_id_uniq`.
  - The same holds for `features_project_idx`.
  
  If M1 is fixed with `(project_id, file_id)`, `symbols_project_idx` can go.
- L6. Nothing checks that the Drizzle schema (src/schema/*) matches the hand-written SQL migrations. AC-002-01 checks table names only (migrations.test.ts:55), not columns, constraints or indexes, so a column added to one side and not the other passes every test.
- L7. The documented single-test command `pnpm vitest run packages/db`, run from the root, fails `check.test.ts` and `testing.test.ts` with "Test timed out in 5000ms". It ignores packages/db/vitest.config.ts (testTimeout 30000, fileParallelism false). `pnpm --filter @brain/db test` passes. This is test infrastructure, not FEAT-002 logic, but it makes the documented command misleading.

## Security / architecture notes (no finding)
- Migration ids are inlined into SQL, but they are guarded by `^[0-9]{4}_[a-z0-9_]+$` (migrations-core.mjs:18). No injection path.
- Tokens are stored as sha256 hashes, and the plaintext is returned once only. 24 random bytes is enough entropy for an unsalted hash.
- `dbPoliciesRepo.insert` checks the parent table's project before inserting (db-schema.ts:52). The cross-project case is tested.
- packages/db has no Next.js imports, and repos take the db client as an argument, so the layering is fine.

VERDICT: FAIL
