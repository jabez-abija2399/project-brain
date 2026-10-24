# Review: FEAT-003 Sign in with GitHub and private projects (security_sensitive)

Date: 2026-10-24. Scope: FEAT-003 files from agent/review-pack.md (apps/web/src/server/*, apps/web/src/app/api/{auth,projects,token}/**,
apps/web/src/app/projects/**, packages/db/src/schema/{auth,projects}.ts, packages/db/src/repos/{projects,project-tokens}.ts,
packages/db/src/repos/auth-invariants.test.ts).

Tests run in this session:
- `cd apps/web && pnpm vitest run src/app/api/projects` → 21/21 pass (projects.test.ts 7, security.test.ts 14).
- `pnpm vitest run packages/db/src/repos/auth-invariants.test.ts` → 4/4 pass.
  (Running the apps/web tests from the repo root fails with "Failed to load url @/app/api/..." because the `@/` alias
  only resolves under apps/web/vitest.config.ts; from apps/web they pass.)

## Criteria
- AC-003-02..07: satisfied by the code and covered by tests that check real DB state (name unchanged, no plaintext in
  any column, revoked or cascaded token gets 401).
- AC-003-08..14 (still in the pending plan): the code satisfies them and security.test.ts / auth-invariants.test.ts
  already cover them.
- AC-003-01: the "creates 'demo' and sees it in the list" part is tested. The "signs in with GitHub" part is not (see L1).

## HIGH
None.

## MEDIUM
### M1. The auth secret falls back to a public hard-coded value and gets around better-auth's production check
`apps/web/src/server/auth.ts:21`: `secret: process.env.BETTER_AUTH_SECRET || "dev-secret-change-me"`.
better-auth 1.7.10 only refuses to start in production when the secret is empty or equal to its own `DEFAULT_SECRET`
(`node_modules/.pnpm/better-auth@1.7.10…/dist/context/create-context.mjs:39-45`). For any other weak value it only logs
a warning. Scenario: the app is deployed to Vercel without `BETTER_AUTH_SECRET` (it is "required: yes" in
docs/architecture.md:100, but nothing enforces that). The app starts and serves sign-in with a secret anyone can read
in this repo. That secret signs the session cookie and the OAuth state, and it encrypts anything better-auth encrypts.
A known key allows forged signed cookies (login-CSRF via state, and full session forgery if cookieCache is ever
turned on). Without this fallback, better-auth would refuse to start (`!secret` → BetterAuthError).
This also breaks the project rule "secrets only via env". Fix direction: no fallback outside test/dev (throw when
`NODE_ENV === "production"` and the env var is missing), plus a test that asserts this.

## LOW
- L1. The real session path is never exercised. Every API test replaces it via `setSessionResolver`
  (apps/web/src/server/test-helpers.ts:25), so `defaultResolver` (auth.ts:58-65), the `[...all]` auth route and the
  drizzleAdapter `usePlural` mapping (auth.ts:20) have no automated coverage. A broken adapter mapping would leave all
  21 tests green while GitHub sign-in fails. An evaluator run against the live app is needed before AC-003-01 counts
  as verified (agent/evaluations/ has no FEAT-003 entry).
- L2. AC-003-02 test (projects.test.ts:64-78) checks signed-out GET list, POST and GET by id, but not signed-out
  PATCH/DELETE `/api/projects/[id]`. The code is correct (`requireUser` runs first at [id]/route.ts:36,51); only the
  test is missing.
- L3. Misleading comment at apps/web/src/app/api/projects/[id]/route.ts:14-15 says unknown keys are "ignored". `.strict()`
  rejects them with 400 (which is what AC-003-10 requires). Someone could "fix" the code to match the comment.
- L4. Duplication: the project-name zod rule is copied in api/projects/route.ts:13 and api/projects/[id]/route.ts:18.
  Pages re-implement the access check with `projectsRepo.get` (app/projects/[id]/page.tsx:21) instead of
  `requireProjectAccess`. Same behavior today, but two places to keep in sync.
- L5. Nothing limits work: POST /api/projects/[id]/tokens (tokens/route.ts:32-47) has no rate limit or per-project
  cap, and `listForProject` / `listByOwner` (repos/project-tokens.ts:25-31, repos/projects.ts:24-26) are unpaginated.
  A signed-in user can create tokens in a loop and make their own token list grow without limit.
- L6. `createUserForTests` (auth.ts:97-106) is exported from the production auth module and nothing uses it
  (rg finds only its definition). Dead code that inserts users directly.

VERDICT: FAIL
