# Progress (newest entry on top; <=8 lines per entry)

## 2026-10-23 | FEAT-003 | status: done (polish pass + browser smoke test)
Changed: apps/web/src/server/auth.ts (drizzleAdapter now passes `usePlural: true`; without it better-auth looked for schema keys `user`/`session`/… but ours are `users`/`sessions`/… and the dev server crashed with "BetterAuthError: Drizzle schema mismatch"); packages/db/vitest.config.ts (testTimeout + hookTimeout raised to 30 s so PGlite doesn't flake when `pnpm -r test` runs apps/web and packages/db in parallel on a saturated CPU); packages/db/src/migrate.mjs (catch block now prints the full postgres error — code/severity/detail/hint/where/position/stack — so a future failure is diagnosable instead of a blank line).
Verified (ran this session): `bash scripts/dev.sh` reached the Next.js dev server; `curl http://127.0.0.1:3000/` returned HTTP 200 containing "Sign in with GitHub" (sign-in button rendered); `curl /api/projects` and `/api/token/whoami` returned HTTP 401 `{"ok":false,"code":"unauthenticated"}` (both with no auth and with a random bearer); `pnpm --filter @brain/db migrate` applied `0000_init` + `0001_auth` to Neon and the second run was a no-op; `_brain_migrations` on Neon lists both migrations; Neon has 18 tables including user/session/account/verification; `bash scripts/verify.sh` PASS (typecheck, lint, 23 tests, kit guard).
NOT VERIFIED: a full GitHub OAuth callback round-trip (requires a browser + a real GitHub OAuth app wired to this localhost); creating a project and seeing it in the list in a browser session (same reason).
Open questions: none.
Next step: human to review agent/plan.json (AC-003-08..12) and import, then start FEAT-004.

## 2026-10-23 | FEAT-003 | status: done
Changed: packages/db (schema.ts adds better-auth user/session/account/verification tables + projects.owner_id FK → user.id + project_tokens.last_used_at; migrations/0001_auth.sql; repos/project-tokens.ts generates `pb_<base64url>` tokens stored only as sha-256 hash; repos/users.ts; repo index exports; package.json adds "./schema" subpath); apps/web (better-auth@1.7.10 wired via drizzleAdapter with GitHub provider, lazy init in server/auth.ts with requireUser + requireProjectAccess returning 404 on wrong owner; server/{db,errors,tokens,validate,test-helpers}.ts; API routes /api/auth/[...all], /api/projects, /api/projects/[id], /api/projects/[id]/tokens, /api/projects/[id]/tokens/[tokenId], /api/token/whoami; UI /, /projects list + CreateProjectForm, /projects/[id] with ProjectTokensPanel; PATCH schema is zod `.strict()` so owner_id in body is ignored; vitest.config.ts gets @/* alias).
Verified (ran this session): `pnpm --filter @brain/web test -- --reporter=verbose` PASS 9/9 (AC-003-01..07 named in output); `pnpm --filter @brain/db test` PASS 8/8; `pnpm -r --if-present typecheck` PASS all 5 packages; `bash scripts/verify.sh` PASS (typecheck, lint, tests, kit guard); `python3 scripts/kit.py pass AC-003-01..07` + `done FEAT-003` recorded baseline 20.
NOT VERIFIED: real GitHub OAuth round-trip in a browser (tests use setSessionResolver to inject a session so handlers run under a real route handler but without hitting GitHub); real Neon connection (no DATABASE_URL set this session).
Open questions: none.
Next step: FEAT-004 (next in agent/features.json todo list).

## 2026-10-23 | FEAT-002 | status: done
Changed: packages/db (schema.ts for 13 product tables w/ cross-driver `$defaultFn(crypto.randomUUID)` text ids and `now()` default; migrations/0000_init.sql with ON DELETE CASCADE from projects to files/symbols/features/decisions/agent_sessions/requests/receipts and unique index files(project_id, path); migrations.ts driver-agnostic runner tracking `_brain_migrations`; migrate.mjs rewritten to apply SQL migrations via postgres.js in transactions; testing.ts createTestDb now applies migrations into PGlite; db.ts drizzle wrappers fromPglite/fromPostgres; repos/{projects,files,symbols,features,requests,receipts}.ts each requiring projectId as first arg; index.ts exports; added drizzle-orm + drizzle-kit (both already in docs/dependencies.md).
Verified (ran this session): `pnpm --filter @brain/db test -- --reporter=verbose` PASS 8/8 (AC-002-01..05 named in output); `pnpm -r --if-present typecheck` PASS all 5 packages; `bash scripts/verify.sh` PASS (typecheck, lint, tests, kit guard); `pnpm --filter @brain/db migrate` PASS (prints "DATABASE_URL not set; skipping migrations").
NOT VERIFIED: real Neon connection (no DATABASE_URL set in this session; migrate against real postgres happens when human runs it with a dev-branch URL).
Open questions: none.
Next step: FEAT-003 (better-auth with GitHub provider; users/sessions tables will be added then).

## 2026-10-23 | FEAT-001 | status: done
Changed: root (package.json, tsconfig.base.json, biome.json, pnpm-workspace.yaml, .nvmrc), apps/web (@brain/web Next.js 15 App Router + /api/health + placeholder home + globals.css tokens), packages/core|cli|agent-kit (@brain/* stubs with vitest), packages/db (@brain/db: checkDb via postgres.js w/ 2.5s timeout, createTestDb via PGlite, no-op migrate script).
Verified (ran this session): pnpm install + pnpm -r build PASS; pnpm test -- --reporter=verbose PASS (7 tests; AC-001-01/02/03 named in output); bash scripts/verify.sh PASS; audit no high vulns (added postcss@>=8.5.18 override); next start on :3010 served HTTP 200 placeholder home and /api/health returned 503 {"ok":false,"db":false} in 1.7s with DATABASE_URL unset.
NOT VERIFIED: GitHub Actions workflow (local CI simulation PASS; actual run happens on push).
Open questions: none.
Next step: FEAT-002 (database schema + first real migration).

## YYYY-MM-DD | FEAT-xxx | status: in_progress | done
Changed (files + why; flag anything outside the plan):
Verified (command + result):
NOT VERIFIED:
Open questions for the human:
Next step:
