# Review: FEAT-003 Sign in with GitHub and private projects (security_sensitive)

Date: 2026-10-24 (round 2, head 15e2260). Scope: agent/review-pack.md diff (HEAD~1..HEAD) plus the FEAT-003 files it
covers: apps/web/src/server/{auth,errors,validate,tokens}.ts, apps/web/src/app/api/{auth,projects,token}/**,
apps/web/src/app/projects/**, packages/db/src/schema/{auth,projects}.ts,
packages/db/src/repos/{projects,project-tokens}.ts, the FEAT-003 tests.

Tests run in this session:
- `cd apps/web && pnpm vitest run src/app/api/projects src/server` → 29/29 pass (projects 7, security 15, limits 4,
  auth 3).
- `pnpm vitest run packages/db/src/repos` (from repo root) → repos.test.ts 6/6 and auth-invariants.test.ts 4/4 pass,
  including the new "revoke keeps the original revokedAt" test.
  (The apps/web tests fail from the repo root with "Failed to load url @/app/api/..." because the `@/` alias only
  resolves under apps/web/vitest.config.ts. That is a test-setup quirk, not a code failure.)
- `python3 scripts/kit.py dupes` → 0 repeated blocks.

## Status of the previous review's findings
- M1 (public fallback auth secret): fixed. `resolveAuthSecret` (auth.ts:18-25) throws in production when the secret is
  missing, and auth.test.ts covers it.
- L2 (signed-out PATCH/DELETE): fixed (projects.test.ts AC-003-02 now covers all five).
- L3 (misleading comment): fixed ([id]/route.ts:14-15 now says unknown keys are rejected with 400).
- L5 (no token cap, unpaginated lists): fixed for the API (20 active tokens per project, pages of max 50, limits.test.ts).
  The UI side is still open, see L2 below.
- L1, L4, L6: still open, restated below.

## Criteria
- AC-003-02..14: the code satisfies them, and tests check real DB state (row unchanged, no plaintext in any column,
  revoked or cascaded token gets 401, UNIQUE/cascade at the DB level against real migrations).
- AC-003-08..14 are still in the pending agent/plan.json. They are covered by security.test.ts and auth-invariants.test.ts.
- Current diff: `toPublicToken` allowlists create and list responses, and the new test asserts the exact key sets.
  The create response key is now `id`, as agent/directives.md 2026-10-24 asks. The tokens panel and all three test files
  were updated to match. Repeated revoke keeps the original `revokedAt` (project-tokens.ts:88-100), and a test covers it.
- AC-003-01: "creates 'demo' and sees it in the list" is tested. "Signs in with GitHub" is NOT VERIFIED (L1).

## HIGH
None.

## MEDIUM
None.

## LOW
- L1. The real session path has no automated coverage. Every API test swaps in a resolver via `setSessionResolver`
  (auth.ts:84), so `defaultResolver` (auth.ts:71-78), the `[...all]` route and the drizzleAdapter `usePlural` mapping
  (auth.ts:33) never run in tests. agent/evaluations/ has only README.md, so no evaluator run exists for FEAT-003.
  Run an evaluator against the live app before AC-003-01 is marked done.
- L2. The dashboard can lose track of an active token. `app/projects/[id]/page.tsx:24` loads only the first page
  (50 rows, newest first) and ignores `nextOffset`, and tokens-panel.tsx has no "load more". Revoked tokens are never
  deleted. Scenario: a user keeps token T1 active, then creates and revokes 50 more tokens. T1 is now row 51: it does
  not appear in the UI, so it cannot be revoked from the dashboard (the API still works). The same applies to
  `app/projects/page.tsx:16` for users with more than 50 projects.
- L3. No limit on projects per user. `POST /api/projects` (api/projects/route.ts:28-38) has no cap and no rate limit,
  so a signed-in user can insert rows in a loop. Tokens are capped (20 active), projects are not.
- L4. Whitespace-only project names are accepted. `z.string().min(1)` (api/projects/route.ts:13, [id]/route.ts:18)
  accepts `{ "name": "   " }` with 201 and stores a blank-looking project. AC-003-05 only says "empty", so this is
  not a criterion failure. `.trim()` before `.min(1)` would close it. (Found by reading the code, not by a test run.)
- L5. Duplication (carried over): the name rule is copied in both route files (lines above). The two pages repeat the
  session and ownership check (`getAuth().api.getSession` + `projectsRepo.get`, projects/[id]/page.tsx:17-22) instead
  of sharing it with `requireUser`/`requireProjectAccess`. They behave the same today, but there are two places to
  keep in sync.
- L6. `createUserForTests` (auth.ts:112-119) is still exported from the production auth module. `rg` finds no caller
  outside its own definition. Dead code that inserts users directly.
- L7. The GitHub OAuth access token is stored in plaintext. `account.accessToken` (schema/auth.ts:52) is a plain text
  column, and better-auth writes the GitHub token there on sign-in. The scope is narrow (`read:user user:email`,
  auth.ts:40), but a DB read leak would expose working GitHub tokens. Consider encrypting it or not keeping it once
  FEAT-003 no longer needs it.

VERDICT: PASS
