# Progress (newest entry on top; <=8 lines per entry)

## 2026-10-29 | FEAT-018 test integrity check in receipts | status: done
Changed: core test-source.ts (linear tokenizer: comments/strings blanked, bracket pairs in one pass) + test-integrity.ts (deleted test files/tests, skip/only/xit/options/ctx skip, removed expect/assert, test-config selection changes incl. package.json; renames by body fingerprint ignoring whitespace/trailing commas). CLI session-end hook compares git base vs working tree locally and sends only flags (masked names/paths, max 50 by priority + omitted) and passing counts from PROJECTBRAIN_TEST_REPORT (<=1e6). Server validates (zod strict), cleans paths, adds passing_tests_dropped; dashboard shows "Test checks".
Verified (ran this session): fresh-context security pass added 3 test files (36 attacks); fixed rename false alarm, ReDoS-quadratic brackets, flag/count caps, client-side masking, bidi in file names; verify.sh PASS (typecheck, lint, tests 753, kit guard); kit.py pass AC-018-01..05.
NOT VERIFIED: real Claude Code/Cursor hook run on a user machine; jest/mocha reports other than numPassedTests; CI-only gates (build, e2e, scanners) until CI runs.
Known issues: none new; design follow-ups in agent/later.md (fail closed on missing end report, fix prompt listing test checks).
Next: FEAT-019.

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
## 2026-10-28 | FEAT-010 session continuity (sprint mode) | status: in_progress (not marked done; verify.sh not green here)
Changed: migration 0011 (directives); repos agent-sessions, decisions, directives (activate: project row lock, 1,000-unit budget, 50-directive cap); packages/core/src/handoff.ts (pure note builder, under 1,500 characters, directives never cut); apps/web/src/server/session-tools.ts (save_progress, list_progress, add_decision, list_decisions, save_directive, where_did_we_stop; confirmDirective for the owner); PATCH /api/projects/[id]/directives/[did] (session only). Security pass (fresh context): 37 attacker tests, 7 findings fixed (budget units, directive cap, section-word forgery, surrogate split, env-style secret masking, zero-width chars in tokens, NUL bytes).
Verified (ran this session): apps/web vitest 135 passed; packages/core 105 passed; packages/db 30 passed; packages/sandbox 6 passed; typecheck all packages PASS; biome ci PASS.
NOT VERIFIED: verify.sh is RED in this container: packages/cli cli.test.ts "M1 an unreadable folder..." fails because the container runs as root (chmod 000 does not block reads). Pre-existing (FEAT-008), not touched here; not reproduced as non-root (root-owned node_modules). kit.py pass/done not run (needs a green verify.sh). Real Postgres concurrency of the FOR UPDATE lock not tested (PGlite). MCP transport is FEAT-011 (not built).
Open questions: [ASSUME] proposal expiry after 30 days not implemented; [ASSUME] 1,000-character active directive budget and 50-directive cap are my choices (see docs/specs/FEAT-010.md section 9 to confirm).
Next: human review of the security-sensitive change (directive confirmation, budget and cap), fix the CLI test in this container or in CI, then kit.py pass for AC-010-01..07 and kit.py done FEAT-010.
## 2026-10-28 | gate fix: permission-independent tests (user chose option 1) | status: done
Changed: packages/cli/src/cli.test.ts M1 no longer uses chmod 000 (root reads chmod-000 folders); readdirSync is mocked to throw EACCES for the locked folder only; the assertions are unchanged. packages/core/src/indexer/indexer.test.ts copies the fixture into a temp dir and writes its runtime files there (it wrote into the tracked tree, which a non-root user cannot write to). Kit guard was failing as non-root only because git refuses the root-owned repo (dubious ownership): run the gate with GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0='*'.
Verified (ran this session): cli.test.ts + indexer.test.ts 18 passed as root and as nobody; verify.sh as root: typecheck, lint, unit/integration tests PASS (kit guard rerun below).
NOT VERIFIED: CI-only steps; the M1 test now proves the error path but not the real chmod path.
Also: packages/cli/src/bin.test.ts builds into a unique .bin-test-* dir inside the package (removed in afterAll) instead of the shared dist/ file that a root run leaves root-owned.
## 2026-10-28 | FEAT-010 done | status: done
Verified (ran this session): verify.sh PASS as root and as an unprivileged user (typecheck, lint, unit/integration 301 tests, kit guard). kit.py pass AC-010-01..07 (test-log); kit.py done FEAT-010.
NOT VERIFIED: CI-only steps (audit, scanners, build, e2e); real Postgres concurrency for the directive lock (PGlite only).
Open: [ASSUME] 30-day proposal expiry and the 1,000-unit budget / 50-directive cap need human confirmation (docs/specs/FEAT-010.md section 9). Human review of the security-sensitive change before merge.
## 2026-10-28 | FEAT-011 remote MCP server | status: done
Changed: /mcp route (mcp-handler + @modelcontextprotocol/server 2.3.1, new row in docs/dependencies.md; unused @modelcontextprotocol/sdk v1 removed); apps/web/src/server/mcp-tools.ts (verifyProjectToken, five tools: where_did_we_stop, get_context_pack, find_similar_component, save_progress, add_decision; per-token and per-project limit 300 calls/min); apps/web/src/server/context-pack.ts (files, component summaries, decisions, confirmed rules; metadata only, masked, 8,000-character cap); filesRepo.byIds. Security pass (fresh context): 29 attacker tests, 3 findings fixed (find_similar_component returned secrets unmasked; a decision could mimic the RULES heading; a feature name could inject header lines), plus the rate limit the pass flagged.
Spec deviation: tool errors are isError results with JSON {code, message, data} (the MCP SDK converts thrown tool errors), not JSON-RPC errors as spec section 7 says; codes are the spec's. Logged in agent/later.md.
Verified (ran this session): verify.sh PASS as root and as an unprivileged user (345 tests); measured p95 on PGlite: where_did_we_stop 11 ms, get_context_pack 12 ms, find_similar_component 9 ms, 0 LLM calls; kit.py pass AC-011-01..06; kit.py done FEAT-011.
NOT VERIFIED: a real Claude Code client against a deployed /mcp (tests send JSON-RPC to the route handler); p95 on Neon; OAuth (not built, v1 is project tokens only); request body size limits (set by Next/Vercel); CI-only steps.
Next: human review (security-sensitive); FEAT-016 one-command agent setup, then dogfood /mcp on this project (directive 2026-10-23).

## 2026-10-28 | build checklist + KI-028 CLI retry on 429 + code-index.ts split | status: done
Changed: docs/build-checklist.md (8 rules, each with an example from past reviews) and a project rule in AGENTS.md. KI-028: the rate limiter's 429 carries Retry-After (seconds to the end of the minute window, via AppError.retryAfter); the CLI's request() retries a 429 up to 5 times, waiting Retry-After clamped to 1-60 s (60 when missing, negative or unreadable; HTTP dates supported), printing "Rate limit reached, waiting N s"; sleep is injected through CliDeps. The bin tests that spawn node get a 30 s timeout (they hit the 5 s default under load). apps/web/src/server/code-index.ts split into code-index-limits.ts, code-index-input.ts, code-index-summarize.ts and code-index.ts (re-exports them; importers unchanged); only change is asPrevious becoming an export.
Verified (ran this session): 5 new KI-028 tests (1 server, 4 CLI) failed before, pass after; verify.sh PASS (typecheck, lint, tests, kit guard); split checked line by line against the original.
NOT VERIFIED: build, e2e, audit, scanners (CI only). Login does not retry on 429 (index only).
Known issues: KI-028 fixed.
Next: human security review of FEAT-008, then FEAT-009.

## 2026-10-28 | FEAT-006 re-review fixes: grouping wired into the index, /dashboard/* containers, React Router routes, create feature | status: done
Changed: the CLI uploads each file's resolved import paths (new nullable files.imports, migration 0010; NULL rows count as changed in the diff) and, after the uploads, calls POST /api/index/:id/features, which groups the stored files (imports + route symbols) and saves the map (saveMap, keyed, user choices kept). M2: route segments form a tree of page routes; a segment with 2+ child routes is a container and the child names the feature (Next.js app/, pages/, src/pages, router URLs). M1: packages/core/src/indexer/react-router.ts reads <Route path element|Component> (nested) and createBrowserRouter/useRoutes objects (element, Component, lazy import) and stores the route on the page's file; the page's diff hash includes its declared URLs so an App.tsx-only change re-uploads it (KI-019 fixed). With no page routes at all, each screen src/App imports directly is a feature (chrome/plumbing folders and names excluded). POST /api/projects/:id/features creates a feature (strict {name}, 404 other projects, 409 duplicate, cap 500 per project under an advisory lock). saveMap inserts links in chunks.
Verified (ran this session): new tests failed first, then pass: core M2 (Next, Lovable), M1 (vite KI-019, data-router-app, bolt-app); server wire-in, cross-project attack, imports attack, legacy NULL imports; CLI end to end (vite-app: 4 features, rename kept on re-index, App.tsx route move moves ReviewDetail); POST create (201/409/404/401/400/cap). Adapted: KI-027 CLI tests now check user links only (grouping adds auto links); AC-008-03 key list gains "imports"; the bin test's fake server answers /features. verify.sh PASS.
NOT VERIFIED: real Postgres/Neon (PGlite only); grouping time on a 10,000-file project (KI-030); subfolder (monorepo) indexes are not grouped by routes (KI-029).
Known issues: KI-019 fixed; KI-029, KI-030 added. Parked in later.md: Expo Router, TanStack/RR7 file routes, the "-2" naming case, empty features, route tables passed by name.
Next: human security review of the new endpoints, then FEAT-009.
## 2026-10-28 | FEAT-009 GitHub App: verified webhooks and incremental re-index | status: done
Changed: migration 0014_github.sql (projects.installation_id, webhook_deliveries, github_install_states); install flow (/api/github/install -> GitHub -> /api/github/callback checks the hashed single-use state, project ownership and, via the OAuth code, that the GitHub user can access the installation; several repos -> /github/select + /api/github/repos + /api/github/link); POST /api/github/webhook (signature on the raw body before parsing, delivery id + signed-body hash recorded once, default-branch push -> one Inngest event per linked project, 202); index-push Inngest job (concurrency 1/project: compare -> fetch only changed files with the installation token -> core indexSources in memory -> saveIndexBatch / removeMissing(only) / groupProject; steps return counts only). core: resolver FileLookup, indexSources, toUpload moved from the CLI. KI-014: no sandbox in the job; changed Supabase migrations (any case) and skipped pushes mark RLS unknown (KI-033).
Security pass (fresh context): 32 attacker tests, 5 findings fixed (dead 3,000-file cap, skipped pushes not failing closed, .SQL case, GitHub's 300-file compare truncation -> cap 299, replay under a fresh delivery id -> signed-body hash).
Verified (ran this session): verify.sh PASS (typecheck, lint, 427 tests, kit guard); semgrep 1.179.0 --config auto: 0 findings; kit.py pass AC-009-01..06; kit.py done FEAT-009. Measured: 10-file push job 47 ms against a mocked GitHub API (PGlite).
NOT VERIFIED: a real GitHub App (no credentials here: install, OAuth exchange, compare cap and redelivery ids are mocked to GitHub's documented behaviour); Inngest serve/signing and step persistence (needs the Inngest runtime); job time against real GitHub; gitleaks (not runnable here); CI-only steps.
Next: human review (security-sensitive); configure the GitHub App (setup URL /api/github/callback, "Request user authorization during installation" on, webhook URL /api/github/webhook) and Inngest keys; FEAT-016/017.
## 2026-10-28 | FEAT-012 request capture and checklist | status: done
Changed: migration 0017_checklist.sql (needs_clarification, proposed_change, proposed_at, status check); core checklist.ts (splitRequest: one llm.complete, labelled USER REQUEST data block, strict per-line zod check, max 10 items, unclear -> needs_clarification, never guessed) and text.ts (oneLineText); server checklist.ts (create_checklist: token-bound project, feature in project, 1-4,000 chars, daily AI budget, logs hash+length only; propose_checklist_change: proposals only; confirmChecklistChange: owner only, applied once); MCP tools create_checklist / propose_checklist_change; PATCH /api/projects/[id]/checklist-items/[itemId]; context pack CHECKLIST section labelled user data. The AC-011-05 rate-limit test got a frozen clock (it could cross a minute boundary).
Security pass (fresh context): 24 attacker tests, 3 findings fixed with one shared oneLineText (NUL in the LLM answer -> 500 after the budget was spent; ESC/BEL stored and shown; NEL U+0085 could forge lines in the context pack and the FEAT-010 handoff note).
Verified (ran this session): verify.sh PASS (typecheck, lint, 465 tests, kit guard); semgrep --config auto: 0 findings; kit.py pass AC-012-01..07; kit.py done FEAT-012.
NOT VERIFIED: the real model (AC-012-02 and AC-012-04 run on scripted model answers; the prompt never ran against Claude here); real Postgres concurrency for the budget and the proposal row lock (PGlite); gitleaks and CI-only steps.
Next: human review (security-sensitive); FEAT-017 dashboard for proposals (confirm should carry proposed_at).
## 2026-10-29 | FEAT-011 fix: dogfooding (token project, list_features, .projectbrainignore, KI-020 scoring) | status: done
Changed: every MCP tool's projectId is optional (bindToken: left out -> the token's project; given and different -> not_found); new MCP tool list_features (featuresRepo.listSummaries: name, primary file count, status, by name, max 200, total + truncated; names masked); where_did_we_stop adds an "ALL FEATURES:" line (max 100 names, cut to the 1,500-char limit; the heading cannot be forged by a name); the CLI walker applies .projectbrainignore files (gitignore syntax, nested, skip reason "projectbrainignored", evaluated separately from .gitignore); root .projectbrainignore ignores tests/fixtures/; similar.ts: singular forms (ies->y, sses/xes/zes/ches/shes -> -es, s; ss/us/is kept), the DB name pre-filter drops a final y (category finds Categories), query words weighted by smoothed IDF over the candidates' names (= project counts, since the pre-filter returns every name containing a query word), other words weigh 1, 13 generic UI words count half. AC-011-01 text change proposed in agent/plan.json (the human approves it with kit.py import); docs/specs/FEAT-011.md updated.
Test change: session-tools.test.ts asserted "Billing" absent from the note; with the new all-features line it now asserts "- Billing" absent (not in progress) and the ALL FEATURES line present.
Verified (ran this session): new tests failed first (5 core, 10 MCP), then pass; verify.sh PASS (typecheck, lint, tests, kit guard).
NOT VERIFIED: real Postgres/Neon (PGlite only); a live Claude Code session against the updated /mcp (the project-brain MCP server was not reachable from this session); AC-011-01 text in features.json waits for the human's import.
Known issues: KI-034 (KI-020 follow-up: threshold, irregular plurals), KI-035 (push index ignores .projectbrainignore).
Next: human approves agent/plan.json (kit.py import); human review of the MCP change (security-sensitive).

## 2026-10-28 | FEAT-013 change receipt | status: done
Changed: MCP tool generate_receipt (core buildReceipt + web service): per-item done/partial/missed with file evidence, changed files grouped by feature, outside_scope list, Not verified section (no evidence or no test changed). One AI call max under the daily budget; 0 files = all missed, no call, no stored status change. Checklist items get a position column (migration 0020) so order is stable.
Security pass (fresh context, 23 attacker tests): fixed concurrent receipts reopening done items (setStatuses only touches open/partial/missed), loose verdict parse ("donez"), ordinary long paths masked as secrets (mask per path segment).
Verified (ran this session): verify.sh PASS (typecheck, lint, tests, kit guard); kit check 0 errors; semgrep (typescript + secrets) 0 findings on the changed files.
NOT verified: real model quality (fake LLM in tests); gitleaks/osv/build/e2e run in CI only.
Next: FEAT-017 receipts feed; design notes in agent/later.md.
## 2026-10-29 | merge origin/main (FEAT-013) into the FEAT-011 dogfooding fix | status: done
Merged: mcp-tools.ts and mcp.test.ts auto-merged (9 tools incl. list_features and generate_receipt; AC-011-01 test lists all); agent/ files keep both sides. agent/plan.json AC-011-01 now lists all 9 tools (waits for the human's kit.py import); docs/specs/FEAT-011.md updated. Receipt prompt caps (rule 4) were already on main (300-char items, 200-char paths, 8,000-char prompt, cut parts under not_verified; AC-013-06 test): no change.
Verified (ran this session): pnpm install (lockfile up to date); kit.py check 0 errors; NO_COLOR=1 verify.sh PASS (typecheck, lint, tests, kit guard).

## 2026-10-29 | FEAT-014 check_package and new dependencies on receipts | status: done
Changed: MCP tool check_package (EXISTS/RISKY/NOT_FOUND/UNREACHABLE + recommendation): age, last release, repository link, known AI-invented names, 7-day release cooldown with an older version suggested (D-018). Registry over https only, no redirects, 8 s timeout, 40 MB cap, names validated before the URL is built, 10-minute cache (1 minute for failures), shared in-flight reads. generate_receipt takes optional package.json before/after text and lists added or re-pointed dependencies with their check (20 lookups, 200 listed, counted against the per-minute limits before any AI call); the text is not stored.
Security pass (fresh context, 25 attacker tests): fixed 11 (dot-only and invisible-character repository links, URL tokens unmasked, secret-shaped names echoed, unpublished/deprecated versions suggested, re-pointed dependencies missed, unbounded stored list, AI budget spent before input/limit checks).
Verified (ran this session): verify.sh PASS; kit check 0 errors; semgrep 0 findings on the changed files; latest main merged (list_features + check_package, optional projectId).
NOT verified: against the live npm registry (tests mock it); gitleaks/osv/build/e2e run in CI only. Known gaps in agent/later.md (ranges check latest, overrides not scanned, memory for 40 MB documents).

## 2026-10-29 | FEAT-015 secret detector and RLS reviewer in receipts | status: done
Changed: core scanSecrets (service-role JWT, sb_secret_, sk_live_, Anthropic, OpenAI, GitHub, AWS, private keys; anon/publishable/demo keys and placeholders skipped), rlsFlags/policyAllowsAll, rlsFindings. CLI `projectbrain scan-secrets [files...] [--since <commit>]` prints masked findings only; `projectbrain index` reads supabase/migrations in the local sandbox and POSTs flags only to /api/index/:id/supabase (owner decision: KI-014 keeps the sandbox off the server). Migration 0023: db_tables.file_id optional + path. generate_receipt takes secretFindings and lists findings (secrets + RLS off / cannot be confirmed / open writes, 200 max, counted omitted).
Security pass (fresh context, 26 attacker tests): fixed 10 (git-quoted names missed, symlinked folders, tracked .env skipped, JWT regex ReDoS, unreadable migrations uploaded as all-clear, SQL comments in USING/WITH CHECK, private-key placeholders, sb_secret_ unmasked, 400 echoing key names) plus caps/--since.
Verified (ran this session): verify.sh PASS; kit check 0; semgrep 0 findings; built CLI smoke test against a local fake API (sandbox child bundled, flags-only body).
NOT verified: sandbox on Windows/macOS user machines; gitleaks/osv/build/e2e in CI only. Outside the plan: packages/sandbox/src/runner.ts (type-only cast), code-index-input.ts and mask.ts (security pass).

## 2026-10-29 | FEAT-011 re-closed | status: done
AC-011-01 was reworded on main (list_features added) and reopened FEAT-011; its exact-list test (all 10 tools incl. list_features and check_package) passes, so it was re-passed from the test log with the owner's OK. agent/plan.json is left for the owner (its list lacks check_package).

## 2026-10-29 | FEAT-016 one-command agent setup (projectbrain init + session hooks) | status: done
Changed: CLI `projectbrain init [--claude] [--cursor]` adds (never overwrites) .mcp.json / .cursor/mcp.json (Authorization: Bearer ${PROJECTBRAIN_TOKEN} / ${env:...}; Claude also headersHelper `projectbrain mcp-headers` from the user-level login, only for the logged-in server), Claude SessionStart/SessionEnd and Cursor sessionStart/sessionEnd hooks, .claude/skills/projectbrain/SKILL.md, .cursor/rules/projectbrain.mdc and an AGENTS.md section; prints added/kept/skipped. `projectbrain hook session-start|session-end` (handoff note; git-based changed files since the session's start commit + untracked, local secret scan, generate_receipt, save_progress, open-item warnings; one warning line when the server is down). New GET /api/hooks/:id/open-items. FEAT-011 re-closed (AC-011-01 re-passed with the owner's OK).
Security pass (fresh context, 34 attacker tests): fixed 13 (token handed to a foreign server via the helper, foreign projectbrain server vouched for, 85 s of timeouts vs 60 s, stdin cwd of another repo, response body echoed, raw/huge server text, unbounded answers, symlinked state file/folder, look-alike hooks, odd shapes reported as set up, malformed open-items silent).
Verified (ran this session): verify.sh PASS; kit check 0; semgrep 0 findings. NOT verified: in a real Claude Code / Cursor session (tests drive the hooks with the documented stdin/stdout formats); Cursor's stderr display; gitleaks/osv/build/e2e in CI only.
## 2026-10-29 | FEAT-006 fix: KI-036 nearest tsconfig.json per file, KI-037 drop emptied features, group.ts split | status: done
Changed: packages/core/src/indexer/tsconfig.ts: indexRepo resolves each file's aliases through its nearest tsconfig.json (walking up to the root; the root also falls back to tsconfig.base.json), following relative extends (string or array, ".json" added, max depth 8, cycles cut); a tsconfig that is a symlink, outside the repo (realpath check), absolute, or a package extends is never read. The JSONC reader no longer treats "/**" inside strings (include globs) as a comment, which is what kept apps/web/tsconfig.json unread on this repo. toUpload's diff hash includes the resolved imports, relative to the file's folder, so a file whose imports start resolving is re-uploaded while a folder moved with its imports keeps its hashes (KI-027 rename). KI-037: saveMap deletes features with a key, no file links (primary or shared) and name_set_by_user false (new column, migration 0022, set by a rename; backfilled for names that are neither the key nor a -N variant); user-created (key NULL) and renamed features stay and show 0 files. group.ts split into placement.ts, screens.ts, group.ts (pure move).
Verified (ran this session): new tests failed first, then pass (group.test KI-036 + monorepo fixture with nested tsconfigs and include globs; hardening attacker test for extends outside/absolute/cycle/symlink; features.test KI-037 x2; upload.test x2). Dogfood on this repo with the rebuilt CLI against the local app: 22 features, other 20 of 218 (9.2%), the 0-file features (fid, home-2, ...) are gone. verify.sh: see commit.
Changed expectation: features.test.ts "a re-index keeps it" no longer expects the emptied automatic "home" (KI-037 deletes it); the user-created feature and its moved file still survive.
NOT VERIFIED: GitHub push re-index still uses the root tsconfig only (KI-038); cause of one transient 500 during the re-index (KI-040).
Known issues: KI-036, KI-037 fixed; KI-038, KI-039, KI-040 new. AC-011-01 text with check_package written to agent/plan.json (human runs kit.py import).
Next: human imports agent/plan.json; FEAT-015.

## 2026-10-29 | FEAT-017 dashboard: feature board, receipts feed, connect page, checklist proposals | status: done
Changed: project pages /projects/:id/{features,receipts,proposals,connect} (+ Tokens tab nav), loading/error states for all, app 404 page; shared components from DESIGN.md (Button, StatusBadge icon+label, Card, DataTable that stacks at phone width, EmptyState with one action, Pagination 50/page, CopyButton, CodeRef, CopyCommand, ChecklistItem, ReceiptCard); core receiptView + fixPrompt ("Send fix to agent"); db dashboardRepo (one bounded query per page) and proposal list/confirm/reject that only act on the exact proposal shown (409 proposal_changed otherwise). Web vitest renders JSX (oxc automatic runtime) for server-side page tests.
Security pass (fresh context, 26 attacker tests): fixed 5 (NUL/malformed ids gave 500 not 404, LRM/RLM in text, slash-containing secrets in paths, raw unknown feature status, stale page links blank) plus fenced fix prompt and a PATCH body cap.
Verified (ran this session): verify.sh PASS; kit check 0; semgrep 0; receipts feed p95 ~14 ms for 50 receipts (PGlite); pages rendered with seed data and screenshotted at 375 and 1280 px (no horizontal overflow). NOT verified: in the running app with a real session (needs DATABASE_URL); gitleaks/osv/build/e2e in CI only.

## 2026-10-29 | FEAT-019 project planning: plan_project tool and dashboard approval | status: done (on branch, PR open)
Changed: core plan.ts (two-stage planner: labelled one-line masked data, strict parse, draft rules, <=2 calls/stage in 28 s), llm.ts (token ceiling 4000 for the planner, per-call timeout), text.ts plainText, handoff NEXT FEATURE line; db migration 0026 plan_drafts + features.build_order, planDraftsRepo (questions/draft/approve in one transaction); web plan_project MCP tool, owner-only approve route (draft id + hash), Plan tab.
Verified (ran this session): fresh-context security pass (29 attack tests, 12 failed first; all fixed: delimiter runs, regeneration prompt as data, invisible marks in names/handoff, case/mark duplicates at approval, empty-looking ideas, existing names cleaned, build order continues, malformed planId 404); verify.sh PASS (808 tests); kit.py pass AC-019-01..08; Plan tab rendered at 375/1280 px with no horizontal scroll.
NOT VERIFIED: a real model's plan quality and real latency (fake LLM in tests); real Postgres concurrency (PGlite); CI-only gates until the PR's CI runs.
Open questions: create_checklist on a planned feature (agent/later.md); app-wide Origin check.
Next: owner review and merge of the FEAT-019 PR.

## 2026-10-30 | Landing page at "/" (outside the 19 planned features) | status: done (on branch, PR open)
Changed: app/page.tsx (signed-out visitors see the landing page; signed-in users still go to /projects; title, description, Open Graph), components/landing/* (header with phone menu, printing receipt, terminal snippets with copy, waitlist form, sections), sign-in-button link variant, copy-button copyText helper, globals.css landing styles (tokens only; reduced motion stops the print animation).
Verified (ran this session): landing.test.ts (7 tests: signed-out render, signed-in redirect, metadata, no invented claims, form confirmation, copy, reduced motion); Playwright on next dev at 375 and 1280 px: no sideways scroll, menu, 3 copy buttons say Copied, form messages, FAQ, keyboard focus; token contrast pairs all >= 4.5:1; verify.sh.
NOT VERIFIED: real sign-in from the landing page against GitHub (no OAuth app here); the 375 px and click checks are not in CI (no e2e suite).
Next: owner review of the landing page PR; decide where waitlist emails go.

## 2026-10-30 | Rename: Project Brain -> Codeceipt (D-019) | status: done (on branch, PR open)
Changed: every user-visible name (landing page, layout and page metadata with the tagline "A receipt for every AI change.", connect page commands, MCP server name, CLI help and messages, receipt hints, fix prompt, docs, AGENTS.md); CLI bin codeceipt (projectbrain kept as an alias) and a dist/package.json that publishes as "codeceipt"; .codeceiptignore (the old .projectbrainignore still read); CODECEIPT_TOKEN/_API_URL/_TEST_REPORT with the PROJECTBRAIN_* fallback; config folder codeceipt/ (old login still read); init upgrades a Project Brain setup in place (server entry, hooks, Skill, Cursor rule, AGENTS.md section).
Verified (ran this session): rename.test.ts (6: init upgrade with no duplicates, edited legacy files left, env and config fallbacks, help text, publish manifest), brand.test.ts, ignore-file tests, all CLI/core/web suites; legacy templates byte-identical to the previous release's; landing page rechecked at 375/1280 px; verify.sh.
Unchanged on purpose: @brain/* packages, database/migrations, Inngest app id, .git session state folder, FEAT spec criteria text.
Next: owner review of the rename PR.

## 2026-10-30 | Production deploy prep (Vercel + Neon) | status: done (on branch, PR open)
Changed: apps/web/src/server/env.ts + instrumentation.ts (production boot check: names missing/malformed variables, never values; private key with real newlines, \n, CRLF or quotes), /api/health services flags (githubApp, inngest, ai), next.config outputFileTracingRoot; machine-only code out of the server: fromPglite moved to @brain/db/testing, the Supabase reader (libpg-query) to @brain/core/supabase; docs/deploy.md runbook; .env.example cleaned (duplicate Inngest lines).
Verified (ran this session): env.test.ts (8), health tests, server-imports.test.ts (import graph of every server entry; fails when the old barrel export is restored); `pnpm --filter @brain/web build` with an empty production env: passes, and the server output no longer contains PGlite or libpg-query (main's build bundled libpg-query); verify.sh.
NOT VERIFIED: a real Vercel deploy, Neon production, GitHub apps and Inngest (no accounts here); the runbook steps were written from the code, not clicked through.
Next: owner runs docs/deploy.md; add a Connect GitHub button (agent/later.md).

## 2026-10-30 | Launch: one-command setup, repo projects, no agent env vars, Origin check, waitlist, pages, publish-ready CLI | status: done (on branch, PR open)
Changed: device approval (/device, /api/device/start|token|approve, migration 0029_launch.sql) and `npx codeceipt` (setup-command.ts); per-repo link .git/codeceipt/project.json with tokens in the user config by server+project; Claude Code headersHelper + Cursor `codeceipt mcp-proxy`; Origin/Referer + JSON-only check in requireUser; waitlist table/route/form and /admin/waitlist (ADMIN_GITHUB_LOGINS, login asked from GitHub); /privacy, /terms, /docs/quickstart, shared footer, single landing step; CLI codeceipt 0.1.0 (one bin, hosted default URL, README, docs/publishing.md). D-020.
Verified (ran this session): failing tests first for each part; fresh-context security pass (3 new files, 6 failures fixed: git-unreadable fallback to another project's token, text/plain CSRF, uncapped chunked bodies, unlimited code lookups on /device, bidi/control in project names, framing) plus token_limit handling; web 500, CLI suite, DB suite; kit.py check; verify.sh (see PR).
NOT VERIFIED: a real browser approval against the deployed app, real `npm install -g` and agent runs, Vercel's X-Forwarded-For behaviour, the new pages at 375/1280 px; nothing published to npm.
Next: owner reviews the security-sensitive parts (device flow, Origin check, admin access), decides license, runs docs/publishing.md.

## 2026-10-30 | D-021 codeceipt init for OpenAI Codex, OpenCode and Google Antigravity | status: done (on branch, PR open)
Changed: init detects and sets up Codex (.codex/config.toml proxy table, .codex/hooks.json SessionStart + SessionEnd with a background --worker), OpenCode (opencode.json mcp, .opencode/plugins/codeceipt.js on session.created) and Antigravity (.agents/mcp_config.json, SessionStart in .agents/hooks.json, always-on rule); shared .agents/skills/codeceipt/SKILL.md with a stay-in-scope line; `codeceipt receipt`; `mcp-proxy --linked-only`; hooks for these agents use only a linked repo's token.
Verified (ran this session): docs of each agent read first (D-021); new tests failed first (init-agents, agent-hooks incl. the real plugin file run with a stand-in codeceipt); fresh-context security pass (2 files, 42 attacks, 14 failures fixed); CLI suite 186 pass; kit.py check; verify.sh (see PR).
NOT VERIFIED: real Codex, OpenCode or Antigravity runs; Codex hook trust review flow; Antigravity hook folder.
Next: owner tries each agent once; later.md items for Claude's plain-stdout note and file size.

## 2026-10-30 | First-time user journey (start page, teaching empty states, terminal messages, end-to-end test, quickstart) | status: done (on branch, PR open)
Changed: /start guided page (3 steps with live status from /api/onboarding: project linked, first index, first receipt; then the first receipt with "How to read it"), /projects sends a user with no receipt yet to /start (?all=1 skips); one-sentence empty states on Features, Receipts, Proposals, Plan; setup ends with "What happens next"; session-end hook prints a 3-line receipt summary with a link (receipt cards have #receipt-<id> anchors); /docs/quickstart rewritten to the journey with [SCREENSHOT] placeholders.
Verified (ran this session): tests first; journey-e2e.test.ts runs the whole journey (real better-auth sign-in with GitHub mocked, npx codeceipt with device approval, index, init, a scripted agent session that misses one item, session end, receipt in the dashboard and the start page); start-page, session-summary, pages tests; full suites; kit.py check; verify.sh (see PR).
NOT VERIFIED: a real browser (live reload, layout at 375/1280 px), a real GitHub sign-in, real agents.
Next: real screenshots for the quickstart; later.md items (setup files in the first receipt, Connect tab).

## 2026-10-30 | Dogfooding fixes from edutech (D-023) | status: done (on branch, PR open)
Changed: tools take a feature by name, key or id (list_features and the start note show ids; a wrong one names the valid features); a session with changed files always gets a receipt (no_request receipts with files by feature and checks, shown on the card); `codeceipt last` + /api/hooks/:projectId/last-receipt (Claude Code does not show SessionEnd output after exit, per its hooks reference); test-only folders go to one tests group; Receipts empty state names all five agents.
Verified (ran this session): tests first; journey e2e replays edutech (a session without a request gets a receipt, then a feature name from the start note creates the checklist); old tests that pinned `not_found` or feature lists without ids updated, keeping their no-oracle and no-leak checks; fresh-context security pass; full suites; kit.py check; verify.sh (see PR).
NOT VERIFIED: a real Claude Code exit (what is shown is from its docs), a real edutech re-run.
Next: later.md items (tie requests to sessions; latest-receipt wording).

## 2026-10-30 | Requests from prompt hooks, tied to sessions, session end exits 0 (D-024) | status: done (on branch, PR open)
Changed: init installs prompt-submit hooks (Claude Code, Cursor, Codex; OpenCode plugin chat.message; Antigravity falls back to create_checklist); /api/hooks/:projectId/requests records each request with 1 AI call (feature + items) against the daily budget; requests.session_id (0032); receipts check only the session's requests; start note "STILL OPEN FROM EARLIER:"; session-end exits 0 and says how many files changed.
Verified (ran this session): tests first (core, web, CLI); journey e2e covers capture, dedup with create_checklist and a later session; old tests updated for exit 0 and the file count; fresh-context security pass; full suites; kit.py check; verify.sh (see PR).
NOT VERIFIED: real Claude Code, Cursor, Codex and OpenCode hook runs; whether Claude Code shows stderr of an exit-0 SessionEnd hook.
Next: later.md items.
2026-10-31 PR #21 CI: osv-scanner flagged new advisories in glob 10.5.0 / minimatch 9.0.9 (inngest > otel > gaxios@7 > rimraf@5). gaxios 7 lists rimraf but never uses it; a pnpm override ("gaxios@7>rimraf": "-") drops it. package.json and pnpm-lock.yaml added to scope for this only.
