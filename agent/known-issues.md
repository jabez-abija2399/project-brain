# Known issues (never delete; set Status from open to fixed with the commit)
| ID | Sev | Feature | Description | Repro | Workaround | Status | Next action |
|----|-----|---------|-------------|-------|------------|--------|-------------|
| KI-001 | LOW | FEAT-001 | servePgliteOverTcp (packages/db/src/testing.ts): after a query that returns a Postgres error over the TCP bridge, PGlite 0.2.17 throws "RuntimeError: memory access out of bounds" during teardown (unhandled error in the test run). Passing paths are unaffected. | Change checkDb query to `select 1 from no_such_table`, run `pnpm vitest run src/check.test.ts` in packages/db | Only use the bridge for success-path tests | open | Retest after upgrading PGlite to 0.5.x (then @electric-sql/pglite-socket can replace the bridge) |
