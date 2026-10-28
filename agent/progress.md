# Progress (newest entry on top; <=8 lines per entry)

## 2026-10-28 | FEAT-008 fix: KI-027 hand-placed files deleted/moved on index + advisory storage lock | status: done
Changed: removeMissing selects the missing files in the range; hand-placed ones are only held (returned as `held`) unless the diff has `final: true`. The CLI re-sends the held batches with final after its uploads; that deletes them (counted in deleted) and first moves their user links to a stored same-hash file not being deleted and not user-placed (a rename). saveFiles' storage-cap check takes pg_advisory_xact_lock(hashtextextended('storage:'||projectId)) instead of locking the project row.
Verified (ran this session): 4 new KI-027 tests (2 server, 2 CLI end to end: rename across diff batches keeps one file, moves the placement, search finds one Button; local delete removes it) failed before, pass after; verify.sh PASS (typecheck, lint, tests, kit guard).
Scope: diff/route.ts added (comment only). NOT VERIFIED: real Postgres/Neon (PGlite only, single connection: that dashboard moves are no longer blocked by uploads is not tested); a same-hash file that already existed (a copy) can also receive the placement.
Known issues: KI-027 fixed.
Next: human security review of FEAT-008, then FEAT-009.

## 2026-10-28 | FEAT-008 finish: AC-008-08..13 + KI-025 subfolder index | status: done
Changed: attacker tests renamed to start with their AC ids (AC-008-08..13). KI-025: the CLI finds the git root (.git upwards), uploads root-relative paths for a subfolder and sends `folder` on each diff; the diff schema requires files and range bounds inside folder/ (else 400) and removeMissing deletes only paths under folder/. Without .git the folder is the root (as before).
Verified (ran this session): KI-025 server + CLI tests failed before the fix, pass after; verify.sh PASS (typecheck, lint, tests 225, kit guard); kit.py pass AC-008-08..13 from the test log; kit.py done FEAT-008.
NOT VERIFIED: real Postgres/Neon (PGlite only; starts_with needs PG 11+); build, e2e, audit and scanners run in CI only; not pushed. A hand-edited config with a plain-http non-local apiUrl is not re-checked on `index` (login refuses it).
Known issues: KI-025 fixed. KI-026 open (LOW).
Next: human security review of FEAT-008, then FEAT-009.

## 2026-10-28 | FEAT-008 CLI login + index (+ KI-022, N1, fresh attempt, server clock) | status: done
Changed: CLI `login` (token from stdin/env, checked via whoami, saved 0600 in the OS config dir) and `index` (local indexRepo -> POST /api/index/:projectId/diff -> upload changed files in batches <= 200 files / 4 MB -> loop .../summarize); routes share indexRoute (token must match the URL project else 404, 60 req/min per token, 413 over 200 files / 5 MB, strict metadata-only schema, safe relative paths). Upload carries summary state over by component hash; summarize reads previous state from listComponents (KI-022), max 40 AI calls/request, server clock (D-016). Core: worker pool refills after every answer (N1/KI-021); after a success, exhausted components get one final attempt; maxCalls. db: codeIndexRepo (hashes, saveFiles, saveSummaries), listComponents({paths}). @anthropic-ai/sdk in apps/web (getLlm, null without key).
Verified (ran this session): verify.sh PASS (typecheck, lint, tests 205, kit guard); AC-008-01..07 via test log; 500-file CLI index end to end 1.6 s (PGlite, fake AI); KI-022 test fails with carry-over disabled (7 vs 6 calls); new core/db/web tests failed before the code.
NOT VERIFIED: real Claude API call; real Postgres/Neon (PGlite only); `next build` (CI); the `projectbrain` bin is a stub (no bundled build yet, agent/later.md); default --api-url is localhost.
Known issues: KI-023 in-memory rate limit + no per-project AI budget (MEDIUM); KI-024 deleted files stay in the index. KI-021, KI-022 fixed.
Next: human security review of FEAT-008 (security_sensitive), then FEAT-009.

## 2026-10-28 | FEAT-007 fix: review M1 + L1-L3 (agent/reviews/FEAT-007.md) | status: done
Changed: summarizeComponents records summaryStatus ok/empty/error, summaryAttempts and summaryAttemptedAt per hash; an attempted unchanged component is not re-sent; errors retry at most once per 24 h, 3 times per hash; the batch stops after 5 errors in a row. createLlm logs failed calls (model, purpose, error class name only) and caps max tokens at options.maxTokens. Query words are capped at 20 for both the DB pre-filter and scoring. Migration 0008 (flags/counters/timestamp only); symbolsRepo lists the new columns. Tests: empty answer + 3 unchanged re-indexes = 0 calls; outage = 5 calls; retry schedule; masking of path/signature/answer.
Verified (ran this session): verify.sh PASS (typecheck, lint, tests, kit guard); 9 new tests (7 failed before the fix; the masking test pins existing behaviour).
NOT VERIFIED: no real Claude API call; nothing loads PreviousSummaries from the DB yet (KI-022, FEAT-008).
Next: FEAT-008 CLI login + index.

## 2026-10-28 | FEAT-007 component registry + find_similar_component | status: done
Changed: core llm.ts (createLlm/complete: client passed in, model claude-haiku-5-5, timeout, max tokens, metadata-only cost log); core components/ (summarizeComponents: metadata-only prompt, hash-gated, <=200 chars, masked; findSimilarComponent: name/path/props token similarity, threshold 0.3); migration 0007 symbols.hash; symbolsRepo.insertMany/listComponents (name ILIKE prefilter); apps/web/src/server/components.ts service; fixture tests/fixtures/component-app.
Verified (ran this session): verify.sh PASS (typecheck, lint, tests 173, kit guard); AC-007-01..05 via test log; perf p95 57-67 ms on PGlite (2,001 components, 40 runs).
NOT VERIFIED: no real Claude API call (fake client only); nothing persists summaries yet (index upload is FEAT-008); MCP tool wiring is FEAT-011; CI-only checks.
Open questions: similarity runs in TS after a Postgres name prefilter (D-005 said "in Postgres"); threshold 0.3 is untuned.
Next: FEAT-008 CLI login + index.

## 2026-10-28 | FEAT-006 closed: feature map | status: done
Changed: no code; AC-006-06 and AC-006-07 (both human-approved) marked passing, FEAT-006 marked done (72 files recorded, test baseline 165).
Verified (ran this session): verify.sh PASS (typecheck, lint, tests, kit guard); kit.py pass AC-006-06/07 via test log; kit.py done FEAT-006.
NOT VERIFIED: CI-only checks (audit, scanners, build, e2e); React Router <Route path> strings are not read (KI-019).
Next: FEAT-008 per brief (CLI login + index).

## 2026-10-28 | KI-017 fix: grouping handles route groups, Pages Router, Vite/Lovable (review M3/L2/L3) | status: done (AC-006-07 pending approval)
Changed: core featureFromPath skips Next.js route groups (inner folder names the feature, so (auth)/login -> login; AC-006-01 expectation updated per user), reads pages/ and src/pages/ (Pages Router, Vite) incl. file names, src/main|App.tsx -> home, only root app/ or src/app/; PascalCase names -> kebab-case. Features carry key + name; automatic keys @home/@other never merge with folders; saveMap names new features from the map name (-2 variant). Fixtures route-groups-app, pages-router-app, vite-app. AC-006-07 proposed in agent/plan.json; L1 parked in later.md.
Verified (ran this session): new tests failed first (9 core, 1 db), pass after (group.test 10/10, db features.test 2/2, web features.test 13/13); verify.sh PASS (typecheck, lint, tests, kit guard) after a lint-only formatting fix.
NOT VERIFIED: CI-only checks; React Router <Route path> strings are not read (KI-019).
Next: human approval of AC-006-07, then FEAT-007.

## 2026-10-28 | KI-016 fix: sandbox test timing flake | status: done
Changed: packages/sandbox + packages/core vitest maxWorkers 1, testTimeout 150 s; sandbox tests use timeLimitMs 120 s (TEST_TIME_LIMIT_MS) except the time-limit tests (1 ms cap check, 20 s loop). Production limit stays 30 s.
Verified (ran this session): verify.sh PASS (typecheck, lint, tests, kit guard); before, verify.sh had failed twice before (core 1 failed under load avg 7-10; core alone 76/76).
NOT VERIFIED: CI-only checks. packages still run concurrently under `pnpm -r` (verify.config is human-only).
Next: FEAT-007.

## 2026-10-27 | FEAT-006 fix: re-index keeps user renames and moves (review M1/M2) | status: done (AC-006-06 pending import)
Changed: migration 0006 features.key (path-derived, unique per project, backfilled = name) + feature_files.placed_by (auto|user); saveMap finds features by key, keeps user-placed files, replaces automatic links of mapped files; PATCH moves are placed_by user; 3 AC-006-06 re-index tests; AC-006-06 proposed in agent/plan.json.
Verified (ran this session): 3 new tests failed before the fix, pass after (features.test.ts 13/13); verify.sh PASS (typecheck, lint, tests, kit guard) after the KI-016 test fix.
NOT VERIFIED: CI-only checks; kit import of AC-006-06 (human); review M3/L1/L2 open (KI-017).
Next: human imports plan.json, then kit pass AC-006-06; FEAT-007.

## 2026-10-27 | FEAT-006 feature map | status: done
Changed: core groupFeatures (routes/folders name features; other files follow their importers; used by 3+ features = shared); fixture tests/fixtures/feature-app; migration 0005 feature_files.role (primary|shared, one primary per file); featuresRepo.byId/update/saveMap, featureFilesRepo.listForFile; PATCH /api/projects/:id/features/:fid (rename, moveFiles; 404 cross-project, 409 duplicate name, atomic).
Verified (ran this session): group/route/db tests (15 new); verify.sh PASS (typecheck, lint, tests, kit guard); kit pass AC-006-01..05 (test-log); kit done FEAT-006 (baseline 155).
NOT VERIFIED: CI-only checks (audit, scanners, build, e2e); no UI (later.md); saveMap not yet called by an index upload (FEAT-008).
Open questions: first verify --quick hit a sandbox timing flake (AC-005-12) under load; logged as KI-016.
Next: FEAT-007.

## 2026-10-27 | FEAT-005 AC-005-15 (catalog guard attacks, T7) | status: done
Changed: guard.test.ts test names now start with AC-005-15 (14 tests; names only, no assertion or fixture changes); AC-005-15 imported by the human.
Verified (ran this session): verify.sh FAIL once (AC-005-13 5,000-table test hit the 30 s limit at load avg ~12; alone it passes in 7.5 s), then verify.sh PASS (typecheck, lint, tests, kit guard); kit pass AC-005-15 (test-log); kit done FEAT-005 (95 files, baseline 139).
NOT VERIFIED: CI-only checks (audit, scanners, build, e2e).
Open questions: AC-005-13 5,000-table test is timing-sensitive under machine load (related to KI-015); not yet logged as a known issue.
Next: FEAT-006 (feature map).

## 2026-10-26 | FEAT-005 AC-005-10..14 (D-014 sandbox) | status: done
Changed: new packages/sandbox (PGlite 0.5.10 child: empty env, WASM/heap caps, 30 s SIGKILL, uuid-ossp+pgcrypto, Supabase stand-ins incl. auth.users/storage.buckets, catalog-DML guard + tamper check, 5,000 caps); core reader executes statements there (execute.ts), mask.ts; 12 review probes un-failed; fixtures schema/rename/realistic made valid Postgres; 3 assertions changed to Postgres values (partition columns, type casing, DO-block table b known).
Verified (ran this session): verify.sh PASS (typecheck, lint, tests 125, kit guard); 0.5.10 measurements (timeout ignored, mem cap 53200 at ~790 MB, no host files/network); kit pass AC-005-10..14 (test-log); kit done FEAT-005.
NOT VERIFIED: CI-only checks (audit, scanners, build, e2e); limits in the FEAT-009 job environment (KI-014).
Open questions: AC-005-09 wording ("not followed" DO blocks -> unknown) no longer matches D-014 behaviour; scan setup 6-10 s vs 3 s target (KI-015).
Next: FEAT-006 (feature map).

## 2026-10-26 | FEAT-005 AC-005-07..09 | status: done
Changed: no code; docs/specs/FEAT-015.md section 3 gains rows AC-015-06 and AC-015-07 (text copied from agent/features.json).
Verified (ran this session): verify.sh PASS (typecheck, lint, tests, kit guard); read replay.test.ts + db-schema.test.ts + review/unknown fixture to confirm each clause of AC-005-07/08/09 is asserted; kit pass AC-005-07/08/09 (test-log); kit done FEAT-005 (37 files, baseline 92).
NOT VERIFIED: CI-only checks (audit, scanners, build, e2e).
Next: FEAT-006 (feature map).

## 2026-10-24 | FEAT-005 AC-005-06 | status: done
Changed: new realistic fixture tests/fixtures/supabase/realistic/migrations (2 files); parser.ts now reads quoted names with spaces ("public"."Team Members", policy "Users can update own profile.") via one shared quote-aware identifier pattern; test AC-005-06.
Verified (ran this session): fixture failed before the fix (2 file errors), passes after; verify.sh PASS (81 tests, typecheck, lint, kit guard); kit pass AC-005-06; kit done FEAT-005 (17 files, baseline 81).
NOT VERIFIED: CI-only checks (audit, scanners, build, e2e). Not covered: E'...' escape strings, nested /* */ comments, same table name in two schemas (schema is dropped, so they merge).
Next: FEAT-006 (feature map).

## 2026-10-24 | FEAT-003 AC-003-08..14 | status: done
Changed: test names only. The existing security/review tests now start with their AC id: security.test.ts (AC-003-08 x3, -09, -10, -11, -12), auth-invariants.test.ts (AC-003-13, AC-003-14 x2). No new tests, no assertions changed, no app code changed.
Verified (ran this session): verify.sh PASS (80 tests, typecheck, lint, kit guard); kit pass AC-003-08..14 (test-log); kit done FEAT-003 (36 files, baseline 80).
NOT VERIFIED: dependency audit, security scanners, build, e2e run in CI only. AC-003-10 is proven with one extra field (ownerId alongside name), not every possible field.
Next: FEAT-005 (AC-005-06).

## 2026-10-24 | FEAT-001 AC-001-06 | status: done
Changed: human decisions applied: .gitleaksignore (one fingerprint, 955ff20), .semgrepignore (scripts/kit.py + semgrep defaults), trustPolicyExclude undici-types@6.21.0 (KI-009 fixed), cooldown 3 -> 7 days (D-013; lockfile re-resolved, ignore pinned 7.0.12).
Verified (ran this session): verify.sh PASS (80 tests); CI run 40086319317 on main tip fb69dbf: success, all 10 verify steps PASS. kit pass AC-001-06 (manual, CI evidence); kit done FEAT-001 (45 files, baseline 80).
NOT VERIFIED: perf and mutation steps are opt-in OFF in verify.config.
Next: FEAT-003 or FEAT-005 (both in progress).

## 2026-10-24 | FEAT-001 AC-001-06 CI red on main (bugfix) | status: partial
Changed: AC-004-05 test writes its gitignored fixture files (secret.txt, .next/, node_modules/) at runtime (never committed, so CI had none); masked the fake sk_live_ key quoted in agent/reviews/FEAT-004.md; resolver.ts wildcard substitution by index (semgrep); pnpm trustPolicy + blockExoticSubdeps; vitest 2.1.9->4.1.12 (vite 8.3.5, @types/node declared in core/db/cli); zod 3->4.6.7; override @esbuild-kit/core-utils>esbuild ^0.25.12.
Verified (ran this session): AC-004-05 fails with the untracked files moved away and passes after the fix; verify.sh PASS (80 tests); locally pnpm audit, osv-scanner 2.6.0, build clean. CI run 40083685738: typecheck, lint, tests, build, e2e, audit, osv-scanner, kit guard PASS.
NOT VERIFIED / still red: gitleaks (fake key lives in pushed commit 955ff20; history scan), semgrep (minimumReleaseAge 4320 vs 10080; kit.py sha1 and urllib). All need human approval (history rewrite or scanner config, protected kit.py, cooldown change).
Next: human decisions above, then re-run CI for AC-001-06. KI-009 (trustPolicy blocks re-resolution).

## 2026-10-24 | FEAT-004 AC-004-08/09 | status: done
Changed: walker.ts readNoFollow (O_NOFOLLOW) used for every indexer read (files, binary sniff, .gitignore, tsconfig); a symlinked tsconfig.json is no longer read (before, it was followed: a real gap). New symlink.test.ts: AC-004-08 (file/dir/ancestor/self/tsconfig symlinks skipped, fs spy shows nothing outside touched) and AC-004-09 (relative, tsconfig-path, normalized ../ and through-symlink imports: resolved null, identical output after deleting the targets, no fs lookup of outside paths).
Verified (ran this session): AC-004-08 test fails without the source change and passes with it. After the human's 64fd62a: verify.sh PASS (typecheck, lint, tests, kit guard); kit pass AC-004-08 and AC-004-09 (test-log).
NOT VERIFIED: CI-only steps (build, e2e, scanners). kit.py done FEAT-004 ran (26 files, test baseline 80) although FEAT-001 is reopened.
Next: FEAT-001 AC-001-06 (GitHub Actions green on main). Open question: agent/plan.json is deleted in the working tree but not committed; left for the human.

## 2026-10-24 | KI-004, KI-005 | status: done
Changed: packages/db/src/schema.ts split by responsibility into src/schema/{columns,auth,projects,code-index,features,sessions,receipts,supabase}.ts + index.ts (export *); package.json "./schema" export now points at src/schema/index.ts; all `../schema` and `@brain/db/schema` imports unchanged. Pure refactor: a script confirmed all 17 table definitions, 26 type exports and the id/createdAt helpers are byte-identical to HEAD; the exported names are identical (helpers stay internal). docs/architecture.md Data model: feature_files and checklist_items list project_id (migration 0003) + one line on same-project composite FKs.
Verified (ran this session): `bash scripts/verify.sh` PASS (typecheck, lint, 61 tests, kit guard).
NOT VERIFIED: nothing new beyond verify (no runtime behavior changed).
Next step: unchanged; agent/plan.json (AC-003-08..14) still awaits human approval.

## 2026-10-23 | FEAT-005 | status: done
Changed: packages/core (new src/supabase/ with tokenize.ts statement splitter that strips `--` + `/* */` comments and respects `'…'`, `"…"`, and `$tag$…$tag$` dollar-quoted strings; parser.ts matches CREATE TABLE / ALTER TABLE ENABLE|DISABLE ROW LEVEL SECURITY / CREATE POLICY — the policy matcher walks balanced parens to pull USING and WITH CHECK expression text, extracts command + roles, folds unquoted identifiers to lowercase and preserves "quoted" case per PG semantics; reader.ts walks a migrations dir sorted by filename and merges tables across files so an RLS flag set in a later migration overrides the earlier CREATE TABLE row; types.ts + index.ts expose TableSchema/PolicySchema/SupabaseReadResult; src/index.ts re-exports readSupabaseMigrations and the types); packages/db (schema.ts adds DbTable/DbPolicy inferSelect/Insert type exports; src/repos/db-schema.ts adds dbTablesRepo + dbPoliciesRepo as plain project-scoped inserts/queries; repos/index.ts re-exports them); tests/fixtures/supabase/migrations (new committed fixture: 0001_init.sql creates public.profiles + "Posts" with multi-column types, 0002_rls_profiles.sql enables RLS and adds 3 CREATE POLICY variants — SELECT/UPDATE/multi-role — with USING and WITH CHECK, 0003_rls_posts_later.sql enables RLS on "Posts" in a later file for AC-005-03, 0004_broken.sql has unbalanced parens for AC-005-04, 0005_comments.sql comes after the broken file and must still be read); packages/db/src/repos/db-schema.test.ts proves AC-005-05 by querying information_schema.columns on the test PGlite — only `rls_enabled` on db_tables and only `command`/`allows_all`/`checks_ownership` on db_policies (no `using`/`with_check`/`expr`/`*_text`/`*_sql` columns anywhere in the public schema), plus a sentinel-string check that no row content contains policy SQL.
Verified (ran this session): `bash scripts/verify.sh` PASS (typecheck, lint, 50 tests, kit guard — baseline bumped from 45 to 50); AC-005-01..05 each appear as a named test in agent/last-verify.log; `python3 scripts/kit.py pass AC-005-01..05` + `kit.py done FEAT-005` recorded 16 feature files; `pnpm vitest run src/supabase/reader.test.ts` 4/4 pass; `pnpm vitest run src/repos/db-schema.test.ts` 1/1 pass.
NOT VERIFIED: real-world Supabase migrations beyond the committed fixture (e.g. CREATE FUNCTION/TRIGGER bodies with `$$…$$` tags are tokenized but no fixture exercises them); very large migrations directories (performance budget not measured — fixture is 5 files).
Open questions: none.
Next step: FEAT-006 is the next in agent/features.json; agent/plan.json (AC-003-08..14) still pending human decision.

## 2026-10-23 | FEAT-004 | status: done
Changed: packages/core (new src/indexer/ with walker.ts, parser.ts, routes.ts, resolver.ts, types.ts, index.ts; src/index.ts re-exports indexRepo + types; package.json promotes typescript to dependencies so the TS Compiler API is importable at runtime; vitest.config.ts sets reporters: ["verbose"] so AC ids are printed per-test even when a test runs <500 ms); tests/fixtures/next-app (new committed fixture: layout.tsx, page.tsx, reviews/[id]/page.tsx, api/health/route.ts, (marketing)/about/page.tsx, components/Button.tsx + Card.tsx, lib/utils.ts, broken.tsx with a deliberate parse error, node_modules/evil/index.js, .next/cache/junk.js, secret.txt, .gitignore with secret.txt listed, tsconfig.json with the @/* → ./src/* alias; big.ts and binary.ts are generated per-test and torn down); biome.json ignores tests/fixtures so the broken.tsx fixture does not fail lint; agent/scope.txt adds tests/**.
Verified (ran this session): `bash scripts/verify.sh` PASS (typecheck, lint, 45 tests, kit guard — baseline bumped from 20 to 45); AC-004-01..07 are each a named test and all 7 appear in agent/last-verify.log; `python3 scripts/kit.py pass AC-004-01..07` + `kit.py done FEAT-004` recorded 23 feature files and the new baseline; indexer parses 500 generated .tsx files in ~400 ms locally (budget: 20 s on CI); AC-004-07 JSON.stringify of the result does not contain a sentinel string planted in source.
NOT VERIFIED: Windows paths (walker normalises via `sep → /`, but no Windows runner was exercised this session); extremely large repos (>5k files) — only the 500-file budget was measured.
Open questions: none.
Next step: FEAT-005 (next in agent/features.json todo list); the still-pending agent/plan.json (AC-003-08..14) remains unimported and is a human decision.

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

## 2026-10-24 | FEAT-003 review fixes (agent/reviews/FEAT-003.md M1, L2, L3) | status: done
Changed: apps/web/src/server/auth.ts: new resolveAuthSecret(env); production without BETTER_AUTH_SECRET now throws instead of falling back to the repo-visible dev secret (better-auth only rejects its own default). New apps/web/src/server/auth.test.ts (3 tests). projects.test.ts AC-003-02 also checks signed-out PATCH/DELETE /api/projects/[id] → 401. [id]/route.ts comment corrected (unknown keys are rejected with 400, not ignored). scope.txt: bracketed paths must be escaped as [[]id] because kit check uses fnmatch.
Verified (ran this session): `bash scripts/verify.sh` PASS (typecheck, lint, tests, kit guard); web API + auth tests 24/24.
NOT VERIFIED: real GitHub OAuth sign-in (AC-003-01) — needs an evaluator run on the live app with GITHUB_CLIENT_ID/SECRET. Review L4-L6 not addressed.
Next step: human approves agent/plan.json + `kit.py import`; evaluator run for AC-003-01; fresh-session /peer-review FEAT-003.

## 2026-10-24 | FEAT-003 fix: limits (review L5) | status: done
Changed: projectTokensRepo.create caps a project at 20 active tokens (transaction + project row lock; TokenLimitError -> 409 token_limit_reached). projectsRepo.listByOwner / projectTokensRepo.listForProject take {limit, offset}, clamp to 50 and return {items, nextOffset}; GET /api/projects and GET /api/projects/[id]/tokens accept ?limit (1-50) & ?offset, 400 on invalid, and return nextOffset. Pages show the first 50. New test apps/web/src/app/api/projects/limits.test.ts (4 tests, shown failing first).
Verified (ran this session): limits.test.ts 4/4 PASS; `bash scripts/verify.sh` PASS.
NOT VERIFIED: concurrent token creation against real Postgres (row lock tested only by design, PGlite is single-connection); UI pages not opened in a browser.
Next step: agent/plan.json (AC-003-08..14) still awaits human approval; L4/L6 parked in agent/later.md.

## 2026-10-24 | FEAT-003 hardening (token response allowlist, idempotent revoke) | status: done
Changed: tokens route.ts uses one allowlist serializer `toPublicToken` (id, createdAt, lastUsedAt, revokedAt) for list and create; create now returns `{ ok, token, id, createdAt, lastUsedAt, revokedAt }` (key `tokenId` renamed to `id`, user-approved; tokens-panel.tsx and 3 tests updated, only the field name). projectTokensRepo.revoke adds `revoked_at IS NULL`, so the original revokedAt is kept. New tests: security.test.ts "token API responses never include the hash..." (checks for no "hash" text + exact key sets), repos.test.ts "revoke keeps the original revokedAt".
Verified (ran this session): both new tests FAILED before the fix (key set mismatch; revokedAt changed 15 ms later), PASS after; apps/web projects tests 26/26; `bash scripts/verify.sh` PASS.
NOT VERIFIED: tokens panel not opened in a browser after the key rename (typecheck only).
Next step: agent/plan.json (AC-003-08..14) still awaits human approval.

## 2026-10-24 | FEAT-003 review L4/L7 | status: done
Changed: project name rule is one shared `projectNameSchema` (apps/web/src/server/validate.ts: trim, 1-80 chars) used by POST /api/projects and PATCH /api/projects/[id]; whitespace-only names now get 400 with fieldErrors.name and padded names are stored trimmed. auth.ts: `account.encryptOAuthTokens: true` (better-auth 1.7.10 encrypts GitHub tokens with the auth secret before writing account rows) and `disableDefaultScope: true` on GitHub, because the provider appended our scope to its defaults and sent "read:user user:email read:user user:email". later.md: review L2 (dashboard paging) and L3 (project cap); L5/L6 already had rows. KI-007 for pre-existing plaintext token rows.
Verified (ran this session): 3 new tests FAILED before the fix (blank name 201; encryptOAuthTokens undefined; duplicated scope), PASS after; apps/web auth + projects tests 32/32; `bash scripts/verify.sh` PASS.
NOT VERIFIED: a real GitHub sign-in writing an encrypted account row (no live OAuth run; the tests check the config and the authorization URL only).
Next step: agent/plan.json (AC-003-08..14) still awaits human approval; evaluator run for AC-003-01 (review L1).

## 2026-10-24 | FEAT-004 review fixes H1, H2, M1-M4 | status: done (new criteria await approval)
Changed: H1 components.ts builds props/signature from the AST (binding names + types with string/number/template literals replaced by their keyword types, comments dropped, no initializers), capped at 200 chars; all params now in signature. H2 walker.ts lstat, symlinks never followed, skipped reason "symlink". M1 resolver.ts: candidates normalizing to ../ or absolute -> resolved null + new ImportIndex.outside=true without touching disk; files reached through a symlink leaving the repo count as missing (realpath check). M2 .gitignore via ignore@7.0.13 (dep-check + docs/dependencies.md row; 7.0.14 was 0 days old): anchored, negation, nested .gitignore files (deeper wins). M3 detects ?:/&&/||/?? returns, memo/forwardRef (incl. React.* and nested), class components with render(), anonymous default export ("default"), export default memo(function X). Detection moved from parser.ts to components.ts (size limit). M4 export-from re-exports and import("x") recorded; external=false for tsconfig path aliases (AC-004-03 assertion corrected from true to false). Tests: new hardening.test.ts (5), AC-004-07 test plants secrets in a default value, prop type literal, signature and initializer; AC-004-05 asserts secret.txt gitignored; AC-004-01 asserts the exact component set.
Verified (ran this session): each new/changed test FAILED before its fix and PASSED after; `bash scripts/verify.sh` PASS after every fix (indexer 12/12 tests).
NOT VERIFIED: indexing a real-world Next.js repo (only fixtures and temp repos).
Next step: human approval of agent/plan.json FEAT-004 AC-004-08 (symlinks) and AC-004-09 (outside imports), then `kit.py import`; LOW findings L1-L7 in agent/later.md; KI-008.

## 2026-10-24 | FEAT-005 review H1, H2, H5, H6 | status: done
Changed: the Supabase reader now parses migrations with libpg-query 18.1.5 (dep-check: 18.2.0 was 0 days old, 18.1.5 is past the 7-day cooldown; prebuilt WASM, no native build). tokenize.ts = Postgres scanner + top-level `;` split; parser.ts reads CreateStmt / CreateTableAsStmt / AlterTableStmt (AT_Enable/DisableRowSecurity commands) / CreatePolicyStmt from the AST; USING/WITH CHECK text and column types come from the source tokens. Each file is parsed whole, else statement by statement; a failing statement goes to errors[] with file + line and the rest of the file is still read. Tables and policies carry `schema` and are keyed by schema.name (default public). readSupabaseMigrations is now async. D-012 updated; directives line added. 4 review fixtures in tests/fixtures/supabase/review/.
Verified (ran this session): 4 new tests FAILED on the old reader (schema merged; no line / file skipped; nested comment -> RLS on; string literal -> RLS on), PASS after; reader tests 9/9; `bash scripts/verify.sh` PASS (85 tests, typecheck, lint, kit guard).
NOT VERIFIED: CI-only checks (audit, scanners, build, e2e); WASM loading inside a Vercel function (no build/deploy run).
Next: KI-010 (review H3/H4: DROP TABLE, ALTER POLICY), KI-011 (M1-M3), then FEAT-006.

## 2026-10-25 | FEAT-005 review H3, H4, M1-M3 + unknown RLS | status: done (new criteria await approval)
Changed: new replay.ts applies statements in file order: DROP TABLE (removes table + its policies; CREATE after DROP starts fresh), ALTER TABLE RENAME TO / SET SCHEMA (moves table + policies), DROP POLICY, ALTER POLICY (only the USING / WITH CHECK / roles it names), ALTER POLICY RENAME. PolicySchema.permissive (AS RESTRICTIVE). TableSchema.rlsUnknown: a table named by an unparseable statement, or by a DO block that touches RLS/policies (all tables if it names none), gets rlsEnabled false + rlsUnknown true; an explicit ENABLE/DISABLE later makes it known again. After a lexical error (unterminated string) the complete statements before it are still applied (libpg-query cursorPosition is a 0-based character offset). DB migration 0004: db_tables.schema, db_tables.rls_unknown (CHECK not enabled+unknown), db_policies.permissive (CHECK restrictive never allows_all); dbTablesRepo.byName takes an optional schema. docs/specs/FEAT-015.md AC-015-04 now matches features.json. agent/plan.json proposes AC-005-07..09. Review LOW L1-L3 parked in later.md. KI-010/011 fixed, KI-013 (column changes not replayed).
Verified (ran this session): 6 new core tests + 1 new db test FAILED before the fix, PASS after; line-exactness fixture FAILED with a 1-based cursor, PASS with 0-based; supabase tests 15/15, db-schema 2/2; `kit.py import --dry-run` adds AC-005-07..09 cleanly; `bash scripts/verify.sh` PASS (92 tests, typecheck, lint, kit guard).
NOT VERIFIED: CI-only checks; migration 0004 on the Neon dev branch (PGlite only).
Next: human approves agent/plan.json -> kit.py import -> kit pass AC-005-07..09; FEAT-015 must treat rlsUnknown as "cannot confirm RLS" and ignore restrictive policies for "allows everyone".

## 2026-10-26 | FEAT-005 change: execute migrations in a sandboxed PGlite (D-014) | status: waiting for approval
Changed: directive line; D-014; docs/specs/FEAT-005.md (threat model for executing untrusted SQL); agent/plan.json proposes
AC-005-10 (state), AC-005-11 (attack), security_sensitive + spec (dry run clean, not imported); 12 review probes (H1 x5,
H2 x5, M1, L3) as fixtures in tests/fixtures/supabase/review/<probe>/ and it.fails tests in packages/core/src/supabase/execute.test.ts.
Verified (ran this session): each probe test fails today on its RLS/policy assertion (ran without .fails); expected values
match real PGlite run one statement at a time; PGlite ignores statement_timeout, cannot read host files or run programs,
has no dblink; --wasm-max-mem-pages=8192 turns a 900 MB allocation into "out of memory" at ~680 MB RSS; verify.sh PASS.
NOT VERIFIED: CI-only checks; nothing implemented yet.
Next: human approves -> kit.py import -> implement D-014, drop .fails from execute.test.ts.

## 2026-10-26 | FEAT-005 change, round 2 (human decisions) | status: waiting for the human to run kit.py import
Changed: packages/sandbox (@brain/sandbox) chosen for the runner; boundaries.txt rules for it; PGlite 0.5.10 production
row in docs/dependencies.md (dep-check: exists, Apache-2.0; 0.5.11 is inside the cooldown); D-014 update; plan.json adds
AC-005-12 (T6), AC-005-13 (T9), AC-005-14 (T10); spec lists stand-ins (net, vault, cron, extensions + CREATE EXTENSION
allowlist answered without running); KI-014 (limits must be verified in the FEAT-009 job environment).
Verified (ran this session): empty schemas do not make CREATE EXTENSION pg_net/supabase_vault/pg_cron/uuid-ossp/pgcrypto
succeed in PGlite 0.2.17; kit.py import --dry-run clean (5 new criteria, no rewording); verify.sh (see commit).
NOT VERIFIED: nothing implemented; measurements not repeated on PGlite 0.5.10.

## 2026-10-26 | FEAT-005 security pass: catalog guard bypasses (T7) | status: waiting for human review + kit.py import (AC-005-15)
Changed: child.mjs guard now on every pg_catalog table except pg_am/pg_amproc/pg_index/pg_opclass/pg_trigger (those crash PGlite's relcache; their built-in rows are xmin-checked instead); guard warns before refusing so a swallowed catalog write sets catalogWrite -> all unknown; stand-in roles pinned by oid+name; final read does reset all / session authorization / role and search_path pg_catalog, pg_temp. execute.ts + both SandboxRun types: catalogWrite. 14 attacker fixtures + guard.test.ts; sandbox.test.ts catalog_dml now expects unknown (was known false), guard_tamper expects the extra error. Spec section 2 + T7 row; KI-015 note; plan.json AC-005-15.
Found (failing before the fix): temp tables named pg_class/pg_policy shadowed the final read (forged RLS enabled, hid a USING (true) policy); renaming anon to service_role disguised an anon policy; swallowed refusals left tables known.
Verified (ran this session): core vitest 72/72 (incl. 14 attacker tests); sandbox vitest 5/5 run alone; typecheck, lint, kit guard PASS.
verify.sh: FAIL x2 under host load (sandbox runner tests hit the 30 s kill, load avg 6-9); then PASS on a quiet machine (load avg 2.3, 139 passing tests, run by the agent with NO_COLOR=1: a colour-coded log counts 0 tests in kit.py).
NOT VERIFIED: CI-only checks; AC-005-15 not imported yet (plan.json left uncommitted).

## 2026-10-27 | FEAT-005 sandbox test stability (KI-015) | status: done
Changed: AC-005-13 cap tests inject rowCap 50 (runner: 50 tables + 50 policies within; core: fixtures with 51 tables / 51 policies over) instead of 5,000+; default 5,000 still asserted as a constant and on a default sandbox (1 ms time limit, no PGlite). SandboxRun carries rowCap; the capped error message uses it. Run types defined once in packages/core/src/supabase/sandbox.ts; packages/sandbox/src/types.ts re-exports them (@brain/core added as a workspace dependency of @brain/sandbox). KI-015 note added.
Verified (ran this session): verify.sh PASS twice in a row (140 tests; load average 2.5-3.6 at the time, not the ~12 that caused the earlier failure).
NOT VERIFIED: CI-only checks (audit, scanners, build, e2e); behaviour at load average ~12.
Next: FEAT-006 (feature map).

## 2026-10-27 | FEAT-005 drop packages/sandbox/src/types.ts | status: done
Changed: deleted packages/sandbox/src/types.ts (human approved); index.ts and runner.ts import the run types from @brain/core directly.
Verified (ran this session): verify.sh PASS (140 tests).
Open questions: agent/features.json (FEAT-005 files) still lists packages/sandbox/src/types.ts; only the human can change it.

## 2026-10-28 | FEAT-008 security pass (KI-023, KI-024, runnable CLI bin) | status: done (new criteria AC-008-08..13 proposed in agent/plan.json)
Changed: rate_counters table (migration 0009, D-010) + rateCountersRepo; per-token rate limit now in Postgres (shared by instances); per-project daily AI budget (default 2,000/UTC day, AI_CALLS_PER_PROJECT_PER_DAY) reserved atomically before summarize calls, unused given back, CLI prints when it is used up. Diff batches carry a byte-order range (after, through]; server deletes stored files in the range that are not listed (codeIndexRepo.removeMissing, symbols cascade). CLI: refuses an empty folder; esbuild 0.28.2 bundles src/main.ts into dist/projectbrain.mjs (bin.mjs stub removed). Attack fixes: https-only --api-url (except localhost), no redirects, secrets masked in route signature/component name, control characters in paths rejected. D-017.
Verified (ran this session): verify.sh PASS (typecheck, lint, 223 tests, kit guard); every new test failed before its fix (db repo, cross-instance limit, budget x3, deletions, bin, http/redirect/masking/control-char attacks, empty-folder guard); built bin run by hand from /tmp (usage exit 2, index without login exit 3, http remote refused exit 2).
NOT VERIFIED: real Postgres/Neon (PGlite only), real Claude API, `next build` (CI), a bin installed globally (npm i -g / pnpm link); default --api-url is still localhost.
Known issues: KI-023, KI-024 fixed; new KI-025 (subfolder index deletes files outside it), KI-026 (budget per project, no per-user/IP cap).
Next: human imports agent/plan.json and reviews this security pass; then FEAT-009.

## 2026-10-28 | FEAT-008 fix: index re-checks the saved apiUrl | status: done
Changed: `projectbrain index` applies the login rule (https only; plain http only for localhost, 127.0.0.1, [::1]) to the apiUrl read from the config file, before any request; a hand-edited unsafe address exits 2 with "run `projectbrain login` again" and sends nothing.
Verified (ran this session): new test failed before the fix (token sent, exit 3), passes after; verify.sh PASS (typecheck, lint, tests, kit guard).
NOT VERIFIED: build, e2e, audit, scanners (CI only).
Next: human security review of FEAT-008, then FEAT-009.

## 2026-10-28 | FEAT-008 review fixes: M1, M2, L1-L6 | status: done
Changed: M1 the walker records folders it cannot list ("folder read failed") and entries it cannot lstat ("read failed"); `projectbrain index` stops with "Cannot read folder <path>: ... Nothing was uploaded or deleted." before any request; removeMissing never deletes a file with a user-placed feature link. M2 per-project storage caps (default 10,000 files / 100,000 symbols, INDEX_MAX_FILES_PER_PROJECT / INDEX_MAX_SYMBOLS_PER_PROJECT) checked in saveFiles under a lock on the project row, 413 project_storage_full with the numbers, a clear CLI message; the index rate limit also counts per project; summarize reads components in pages of 1,000 (listComponents afterId/limit) and keeps only what one request can send. L1 the login prompt reads the token in raw mode, without echo (prompt.ts). L2 a relative or empty XDG_CONFIG_HOME is ignored. L3 files whose names break the server's path rule are skipped and listed by name. L4 a .git in the home folder or above is ignored (the folder is the root; the CLI says so). L5 rate-limit tests freeze the clock mid-minute (vi fake Date). L6 index redirect test.
Verified (ran this session): the new server tests (per-project rate limit, storage caps, caps defaults, paged summarize, user-placed file kept) and the CLI tests (M1, L2, L3, L4, storage-cap message, prompt) failed before the fixes, pass after; the L6 test passed before (test gap only) and fails when redirects are followed (mutation check); verify.sh PASS (typecheck, lint, tests 240, kit guard).
NOT VERIFIED: the hidden prompt in a real terminal (unit test with a fake TTY only); real Postgres/Neon (PGlite only; SELECT ... FOR UPDATE lock not tested under real concurrency); build, e2e, audit and scanners run in CI only.
Known issues: new KI-027 (deleted user-placed files stay), KI-028 (per-project rate limit can stop a very large index; no CLI retry).
Next: human security review of these fixes, then FEAT-009.
