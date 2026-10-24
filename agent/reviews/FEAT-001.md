# Peer review: FEAT-001 Walking skeleton

Reviewed at HEAD 6b6f947. FEAT-001 files come from `kit.py where FEAT-001`; the review-pack diff starts after FEAT-001.
Commands run in this session: `pnpm -r build` (exit 0), `pnpm test` (exit 0, 57 tests), `gh run list/view` +
downloaded CI `verify-log` artifact, and a scratch timing probe of `checkDb` (in /tmp, no source changes).

## HIGH

### H1. AC-001-03 not met: a truly unreachable DB host takes ~9 s, not < 3 s
- `apps/web/src/app/api/health/route.ts:9` sets `TIMEOUT_MS = 8000` and passes it to `checkDb`, which also sets
  `connect_timeout` to 8 s (`packages/db/src/check.ts:7`). The comment on line 7-8 assumes "TCP ECONNREFUSED is immediate",
  but that only holds for a closed port on a live host. A blackholed or firewalled host (the usual "unreachable" case)
  waits for the whole timeout.
- Evidence (scratch probe calling the real `checkDb(url, 8000)`, same values as the route):
  - `postgres://x:x@10.255.255.1:5432/none` → `{"ok":false,"reason":"timed out after 8000ms"}` in **9005 ms**
  - `postgres://x:x@db.does-not-exist.invalid:5432/none` → ENOTFOUND in 524 ms
- Test gap: `route.negative.test.ts:7` and `check.test.ts:7` only use `127.0.0.1:1` (connection refused, instant), so the
  boundary the criterion is about is never tested. `check.test.ts` also passes 1500 ms instead of the route's 8000 ms.
- Scenario: Neon endpoint is unreachable at the network level → load balancer/uptime probe gets 503 after 9 s; with a
  typical 3-5 s probe timeout it records a timeout instead of the 503 the criterion promises.

### H2. AC-001-06 not met: the CI verify workflow is red for every FEAT-001 commit
- `gh run list --workflow verify.yml`: the only run that includes FEAT-001 code (run 39952254050, head d62587c
  "FEAT-001: raise /api/health timeout…") is **failure**. The FEAT-001 commits were pushed together, so no other run covers
  them. The skeleton commit (01e0e49) never got a green run.
- The CI `verify-log` artifact shows the "Verify gate" step failed on blocking CI-only steps:
  - semgrep (`--error`): 5 blocking findings (pnpm-workspace.yaml `minimumReleaseAge` 4320 < 10080, missing
    `blockExoticSubdeps`, missing `trustPolicy`; plus 2 in protected `scripts/kit.py`, which is human-only).
  - osv-scanner: 15 known vulns incl. 3 Critical (vitest 2.1.9 GHSA-5xrq-8626-4rwp 9.8; tinypool 1.1.1 ×2 9.5) and
    vite 5.4.21 High.
- Local `verify.sh` passes because these steps only run under CI=true, so "Last verify: PASS" doesn't cover AC-001-06.
- Note: `.github/workflows/verify.yml:108-110,117-118` still has the PROJECT migrate/env placeholders commented out.
  That's fine while tests use PGlite, but nothing in CI runs `migrate` (AC-001-05 path) yet.

## MEDIUM

### M1. AC-001-04 only partly met: `pnpm test` does not use the verbose reporter
- `package.json:11`: `"test": "pnpm -r --if-present test -- --reporter=verbose"` makes each package run
  `vitest run -- --reporter=verbose` (seen in the test log: `packages/cli test$ vitest run -- --reporter=verbose`). The
  literal `--` means vitest never applies the flag, so the default reporter runs.
- Evidence from `pnpm test` output: cli and agent-kit print only `✓ src/index.test.ts (1 test)`, with no test names. The
  same is true for `check.test.ts`, the AC-001-02 health test, and the FEAT-002/003 suites. Running
  `pnpm --filter @brain/cli exec vitest run --reporter=verbose` does print
  `AC-001-01 exposes the package identity and help text`. Test names only show up today when the default reporter
  happens to expand a file (slow tests or some multi-test files).
- Impact: AC ids aren't reliably printed, so any tooling that greps the log for AC names (e.g. verify's "named test in
  last-verify.log") can miss criteria.

### M2. AC-001-02 test mocks the code under test; the reachable-DB path is never run
- `apps/web/src/app/api/health/route.happy.test.ts:3-5` replaces `checkDb` with `async () => ({ ok: true })`. No test
  runs `checkDb` successfully against a real Postgres, so a bug in the `select 1` / client options / `sql.end` path (e.g.
  a wrong option that always rejects) would still pass this test and AC-001-02. Only the 200 JSON mapping is tested.
- Suggestion: a PGlite-socket or CI Postgres service test for `checkDb` ok:true, or at least an integration check
  against `DATABASE_URL` when it's set.

## LOW

### L1. `checkDb` overruns its own timeout and leaks the timer
- `packages/db/src/check.ts:10` never clears the `setTimeout`, so every successful health check keeps an 8 s timer
  alive. `finally` (line 30) awaits `sql.end({ timeout: 1 })` after the race, so the call takes up to timeout + ~1 s
  (measured 9005 ms vs 8000 ms in H1). Any fix for H1 has to budget for this extra second.

### L2. Unauthenticated `/api/health` opens a new DB connection per request
- `check.ts:13` creates a new postgres client (TCP + TLS to Neon) on every GET, and the route has no rate limit or
  caching. Scenario: an anonymous client loops on `/api/health` → one Neon connection handshake per request (connection
  and compute churn). During an outage each request holds a function invocation for ~9 s (H1). Low impact for a trial,
  but worth a short cache or a rate limit.

## Not verified in this session
- AC-001-05 (`bash scripts/dev.sh` migrates + serves the placeholder page): not run, because it writes to the real Neon
  dev branch and needs `.env`, which I may not read. Script reviewed only: `scripts/dev.sh:17,24-25` looks correct.
- AC-001-01: `pnpm -r build` passed on this working tree, not on a fresh clone. `build` for the 4 packages is
  `tsc --noEmit`, which is acceptable for a skeleton.

VERDICT: FAIL
