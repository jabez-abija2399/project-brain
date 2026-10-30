# Decisions (append-only; settled decisions are not re-litigated without new evidence)
# Format:
# ## D-001 | YYYY-MM-DD | <title>
# Context: <constraints that forced a choice>
# Options: (A) ... CHOSEN. (B) ... REJECTED (why). (C) ...
# Trade-offs: <what we accept>. Revisit when: <signal that would change the decision>.

## D-001 | 2026-10-23 | Trial stack: one Next.js app on Vercel, no separate backend server
Context: solo founder building with Claude Code, near-$0 budget, YC application soon.
Options: (A) Next.js on Vercel + Inngest + Supabase CHOSEN. (B) Next.js + separate Hono worker REJECTED (two deploys,
cost, not needed yet). (C) Next.js on an always-on container REJECTED for now (cost, no scaling).
Trade-offs: 300 s function limit (Hobby), Vercel Hobby is non-commercial. Revisit when: charging users (move to Vercel
Pro), a job needs > 300 s after splitting, or MCP p95 > 500 ms because of cold starts.

## D-002 | 2026-10-23 | Never store user source code
Context: trust from teams and agencies; privacy is a selling point.
Options: (A) store index metadata + summaries only, fetch code on demand CHOSEN. (B) store full source REJECTED (risk,
storage, trust). Trade-offs: some checks re-fetch files from GitHub. Revisit when: never without explicit user opt-in.

## D-003 | 2026-10-23 | Index locally in the CLI where possible
Context: serverless time limits and privacy. Options: (A) CLI indexes on the user's machine, GitHub App handles
incremental updates CHOSEN. (B) all indexing server-side REJECTED (time limits, source leaves the machine).
Trade-offs: two index paths share packages/core. Revisit when: web-builder users dominate.

## D-004 | 2026-10-23 | better-auth for sign-in and MCP OAuth
Context: GitHub sign-in plus OAuth for remote MCP clients. Options: (A) better-auth CHOSEN. (B) next-auth v4 REJECTED
(no OAuth provider for MCP). (C) Clerk REJECTED (cost at scale, lock-in). Trade-offs: younger project; cooldown applies.
Revisit when: a security advisory or missing MCP OAuth feature.

## D-005 | 2026-10-23 | Lexical similarity before embeddings
Context: find_similar_component must be fast and free. Options: (A) name/props/path token similarity in Postgres CHOSEN.
(B) pgvector embeddings now REJECTED (extra provider + cost). Revisit when: dogfooding shows missed matches.

## D-006 | 2026-10-23 | First agents: Claude Code and Cursor
Context: they support hooks, so guards can enforce. Options: (A) Claude Code + Cursor first CHOSEN. (B) all agents at
once REJECTED (scope). Revisit when: MVP done; then Codex, Gemini CLI, Lovable/Bolt/Replit via MCP + GitHub.

## D-007 | 2026-10-23 | No Docker: Supabase dev project for development, PGlite for tests
Context: the founder does not want Docker on their machine. Options: (A) Supabase free dev project + PGlite in tests
CHOSEN. (B) Docker Postgres REJECTED (user directive). (C) Postgres installed natively REJECTED (setup per machine).
Trade-offs: development needs internet; PGlite may differ from Supabase on extensions (pgvector later). Revisit when:
a test passes on PGlite but fails on Supabase.

## D-008 | 2026-10-23 | Our own database: Neon instead of Supabase (supersedes the Supabase parts of D-001 and D-007)
Context: we only need plain Postgres (sign-in is better-auth); Supabase free projects pause and need a manual unpause.
Options: (A) Neon CHOSEN: auto-wakes on the first query, 10 free branches per project (dev branch, safe migration tests),
100 free projects, startup credits. (B) Supabase REJECTED for our own data (extras unused, manual unpause).
Trade-offs: free compute scales to zero after 5 min, so the first query after idle can add a few hundred ms (MCP p95
target); 0.5 GB free storage per project (fine: metadata only). Revisit when: MCP p95 misses 500 ms because of cold
starts (Launch plan can disable scale-to-zero) or storage nears 0.5 GB.
Note: Supabase stays a TARGET stack in the product (FEAT-005 and FEAT-015 read users' Supabase migrations and RLS).

## D-009 | 2026-10-23 | Receipt checklist judging uses the smallest Claude model, at most 1 LLM call per receipt
Context: receipts must be fast and cheap; everything else in a receipt is deterministic.
Options: (A) smallest Claude model, max 1 call per receipt CHOSEN. (B) larger model REJECTED (cost, latency). (C) no LLM REJECTED (receipts misjudge items).
Trade-offs: we accept misses in dogfooding (users will correct them). Revisit when: receipts misjudge items in dogfooding.

## D-010 | 2026-10-23 | Rate limits use a Postgres counter table (no new dependency)
Context: FEAT-008 and the MCP route need per-token rate limiting; we already run Postgres.
Options: (A) a `rate_counters(key, window_start, count)` table CHOSEN (no new dep, works on Vercel + Neon). (B) @upstash/ratelimit REJECTED (new provider + dep). (C) rate-limiter-flexible with a Postgres store REJECTED (extra dep for little gain).
Trade-offs: a counter write per request; fine while traffic is low. Revisit when: request volume makes it slow (bump to Upstash/Redis).

## D-011 | 2026-10-23 | FEAT-004 indexer uses the TypeScript Compiler API, not web-tree-sitter
Context: the MVP only indexes TypeScript/JavaScript (D-006: React/Next.js + Supabase target stack), and FEAT-004 needs
exact component props, exported symbols and import resolution. Options: (A) TypeScript Compiler API CHOSEN: exact types,
props and exports with no extra grammar; already a transitive dep of Next.js. (B) web-tree-sitter + ts-morph REJECTED
for now: WASM grammars give syntax but not types; ts-morph wraps the same compiler with more overhead. Trade-offs:
TS/JS only; the `typescript` package is large (~60 MB) and counts against the Vercel function size limit. web-tree-sitter
and @vscode/tree-sitter-wasm stay approved (docs/dependencies.md) for when we add other languages. Revisit when: adding
a non-TS language (Python, Go, Ruby), or if `typescript` pushes a Vercel function over the size limit (then move parsing
to a job or swap in web-tree-sitter for the server path).

## D-012 | 2026-10-23 | FEAT-005 Supabase reader uses a hand-written SQL reader, not libpg-query
Context: FEAT-005 only needs CREATE TABLE columns, ALTER TABLE ... ROW LEVEL SECURITY and CREATE POLICY from users'
migrations. Options: (A) hand-written tokenizer + statement matchers in packages/core/src/supabase CHOSEN: no native or
WASM dependency, nothing extra in the Vercel bundle. (B) libpg-query REJECTED for now: real Postgres parser, but ships
native/WASM builds. (C) pgsql-ast-parser, node-sql-parser REJECTED (incomplete Postgres dialect). Trade-offs: we parse a
subset of Postgres; unusual syntax can be misread or land in errors[]. libpg-query stays approved (docs/dependencies.md).
Revisit when: the realistic-migrations criterion (AC-005-06) fails and cannot be fixed cleanly in the reader.
Update 2026-10-24 (human request, FEAT-005 review H1/H2/H5/H6): switched to (B) libpg-query, pinned 18.1.5 (newest past
the 7-day cooldown, D-013; prebuilt WASM, no install script, no native build). The review showed the hand-written reader
reporting RLS as enabled when it is off: nested /* */ comments, RLS words inside string literals, one unreadable statement
dropping the rest of its file, and schemas merged. The real Postgres parser and scanner fix these at the root. Each file is
parsed whole; if that fails it is re-parsed statement by statement (split at top-level `;` by the Postgres scanner) and each
failing statement goes to errors[] with file and line. Tables and policies are keyed by schema.name (default public).
readSupabaseMigrations is now async (the WASM module loads once). Cost: ~1.7 MB WASM in packages/core.
Revisit when: the WASM size matters for a Vercel function, or libpg-query stops tracking new Postgres versions.

## D-013 | 2026-10-24 | Dependency cooldown raised from 3 to 7 days
Context: semgrep's supply-chain rule (pnpm-minimum-release-age) requires a 7-day minimum release age; ours was 3 days
(kit.py harden default). Decision: Dependency cooldown raised from 3 to 7 days (semgrep supply-chain rule).
Security fixes may bypass it only with human approval. Set as `minimumReleaseAge: 10080` in pnpm-workspace.yaml.
Scope: our own install policy only. The product's check_package cooldown (FEAT-014, AC-014-06: flags versions younger
than 3 days) stays a separate choice and is not changed by this decision.
Revisit when: a security fix is needed sooner than 7 days (the human approves each bypass).

## D-014 | 2026-10-26 | FEAT-005 gets RLS state by executing migrations in a sandboxed PGlite, not by static replay
Context: the 2026-10-26 review (agent/reviews/FEAT-005.md, H1, H2, M1, L3) found 12 valid migrations where the static
replay (D-012 update) reports RLS enabled or a policy as safe while Postgres ends with RLS off or USING (true): dynamic SQL
through format()/||, functions called by SELECT, DROP SCHEMA, DDL inside DO blocks, SET search_path, BEGIN/ROLLBACK.
Each fix in the static reader only covers one more pattern. Options: (A) keep extending the static replay REJECTED: it
fails open on anything it does not model. (B) execute the migrations in a disposable in-memory Postgres and read the
result from pg_catalog / pg_policies CHOSEN: Postgres itself decides the end state, so every probe above is right by
construction. (C) a real Postgres per scan (Docker, Neon branch) REJECTED: no Docker (D-007), network round trips, cost.
Decision: PGlite (already approved, docs/dependencies.md) runs in a child process with no env, `--wasm-max-mem-pages`
and `--max-old-space-size` caps, SIGKILL after 30 s total. It first creates Supabase stand-ins (roles anon,
authenticated, service_role; schema auth with stub auth.uid() / auth.jwt(); schema storage with an objects table;
schema extensions), then runs each statement separately in file order (split by libpg-query, as today) and finally reads
tables, columns, relrowsecurity and pg_policies. A statement that fails goes to errors[] with file and line and the
tables it touches become RLS unknown, found by the existing static reader (all tables when it cannot tell). Timeout,
out-of-memory or a dead child makes every table unknown. libpg-query and the static reader stay, for splitting and for
naming the tables of failed statements. packages/core stays pure: it takes the sandbox as an argument (interface
MigrationSandbox); the PGlite runner lives in packages/db, where PGlite moves from a dev to a production dependency.
Trade-offs: user SQL now runs (threat model: docs/specs/FEAT-005.md section 5); PGlite cold start (~1-2 s) and up to
~700 MB RSS per scan; Supabase-only objects we did not stand in (pg_net, vault, cron, other roles) fail and make their
tables unknown, never enabled. Measured 2026-10-26 on PGlite 0.2.x / Node 20: statement_timeout is ignored (pg_sleep(1)
ran under a 100 ms limit), so the time limit must be enforced from outside; host files and programs are not reachable
(pg_read_file, COPY FROM PROGRAM, lo_import fail on PGlite's in-memory filesystem); dblink is not available; with
`--wasm-max-mem-pages=8192` a 900 MB string fails with "out of memory" at ~680 MB RSS instead of ~1.4 GB.
Revisit when: scans need Supabase objects the stand-ins cannot fake, or PGlite cold start breaks the 30 s budget.
Update 2026-10-26 (human decision): the PGlite runner goes in a new package packages/sandbox (@brain/sandbox), not
packages/db, because the CLI indexes locally (D-003) and must not import @brain/db; boundaries.txt forbids
packages/sandbox from importing apps/** or @brain/db*. PGlite is pinned to 0.5.10 there (cooldown, D-013); the 0.2.17
measurements above are repeated on 0.5.10 before relying on them. Stand-ins also get empty schemas net, vault and cron;
empty schemas do not make CREATE EXTENSION succeed (measured: "extension pg_net is not available"), so CREATE EXTENSION
of a listed Supabase extension is answered as succeeded without running it. New criteria cover T6 (empty env), T9
(5,000 table/policy cap) and T10 (error messages cut and masked).
Update 2026-10-26 (implementation, measured on PGlite 0.5.10 / Node 20): the 0.2.17 results hold (statement_timeout
ignored; WASM memory cap stops a 900 MB string with 53200 at ~790 MB peak RSS; no host files, dblink/postgres_fdw/http/
pg_net/file_fdw unavailable), except COPY FROM PROGRAM, which no longer errors but runs nothing and breaks the session
(run ends as crash, all unknown). uuid-ossp and pgcrypto are loaded from PGlite's bundled extensions (human decision).
New: migrations run as a superuser in PGlite but not in Supabase, and a superuser could forge "RLS enabled" with
catalog DML that Supabase refuses (measured); a non-superuser session is not possible in PGlite, so the sandbox adds
triggers that refuse catalog DML with 42501 (they need a dump and reopen to load on nailed catalogs) and treats any
change to them as tampering (all unknown). Cost: 6-10 s per scan instead of < 3 s (KI-015). Node's permission model
cannot be used (PGlite calls process.binding).

## D-015 | 2026-10-28 | find_similar_component scores in TypeScript; Postgres only pre-filters by name (refines D-005)
Context: FEAT-007 needs p95 < 200 ms for 2,000 components. Options: (A) Postgres keeps components whose name contains a
query word (ILIKE, parameterized), then @brain/core scores name/path/props tokens in TypeScript CHOSEN: camelCase splitting
and weighting are simple to test in pure core, and a match needs a shared name word anyway (path and props alone max at
0.2 < threshold 0.3). Measured p95 57-67 ms on PGlite (2,001 components); without the pre-filter 245 ms. (B) all scoring
in SQL (pg_trgm or token arrays) REJECTED for now (camelCase tokenizing in SQL is awkward; PGlite extension support
unchecked). Trade-offs: a threshold of 0.2 or lower skips the pre-filter and reads every component. Revisit when: a
project has well over 2,000 components or production p95 approaches the budget.

## D-016 | 2026-10-28 | FEAT-008 index upload: diff, upload, then a bounded summarize step the CLI calls; no Inngest yet
Context: the CLI uploads metadata to /api/index/:projectId (token auth); component summaries need AI calls (seconds each)
and must not slow the 500-file < 60 s budget or a request. Options: (A) three routes: POST .../diff (which paths changed),
POST ... (one batch <= 200 files / 5 MB, carries summary state over by component hash), POST .../summarize (at most 40
AI calls per request, server clock, previous state read from the DB); the CLI loops summarize while components remain
CHOSEN: every request is bounded, no job runner needed in the trial stack, tests drive it end to end. (B) summarize
inside each upload REJECTED (a first index would take minutes per batch). (C) an Inngest job per upload REJECTED for
now (Inngest is not wired yet; adds a moving part before FEAT-009 needs it). Trade-offs: summaries finish only while the
CLI runs (or on the next index); two concurrent summarize calls can both attempt one component. Revisit when: FEAT-009
adds Inngest (push re-index should summarize in the job).

## D-017 | 2026-10-28 | FEAT-008 deletions via byte-order diff ranges; daily AI budget by reservation; CLI bundled with esbuild
Context: KI-024 (deleted files stayed indexed), KI-023 (in-memory rate limit, no AI budget), and the CLI bin was a stub.
Deletions: (A) each diff batch carries (after, through], the range of local paths it covers in UTF-8 byte order; the
server deletes stored paths in the range it does not list CHOSEN: stateless, works with 200-file batches, Postgres
COLLATE "C" matches the CLI's Buffer.compare order. (B) a full path list in one request REJECTED (breaks the 200-file /
5 MB limit). (C) a server-side index "session" REJECTED (state across requests). Budget: reserve min(40, due) calls
atomically in rate_counters (key ai:<project>, UTC day) before summarizing and give unused ones back, so parallel
requests never pass the limit together; over the budget the summarize response says budgetExhausted + resumesAt.
Rate limit: fixed one-minute windows in the same table (D-010), pruned after 2 days. CLI: esbuild 0.28.2 bundles
src/main.ts + @brain/core into dist/projectbrain.mjs; typescript, ignore and libpg-query stay external dependencies
of @brain/cli (tsup REJECTED: extra wrapper dep; tsc emit REJECTED: extensionless .ts imports, no bundling).
Trade-offs: a subfolder index deletes the files outside it (KI-025); the budget is per project, not per user (KI-026).
Revisit when: FEAT-009 runs indexing in Inngest (reuse the same budget key), or request volume makes the counter slow.


## D-018 | 2026-10-29 | check_package uses the 7-day release cooldown
Context: D-013 kept the product's check_package cooldown (AC-014-06, 3 days) separate from our own 7-day install policy.
Decision (owner): check_package flags versions younger than 7 days, matching D-013. This covers AC-014-06's
"fewer than 3 days" case and also flags 3-6 day old versions. Suggested versions are the newest stable version at
least 7 days old.
Revisit when: users report the 7-day window blocks needed security fixes (they can still install after review).

## D-019 | 2026-10-30 | The product is renamed "Codeceipt"
Context: "Project Brain" was a working name (docs/product.md [OPEN]). The receipt is what users remember and trust.
Decision (owner): the product is "Codeceipt", tagline "A receipt for every AI change." Everything users see moves:
dashboard and landing text, page titles and metadata, the MCP server name, CLI messages and help, docs. The CLI
command is `codeceipt` and the public npm package is "codeceipt" (built as packages/cli/dist; the workspace package
stays @brain/cli). Renamed with fallbacks so no existing setup breaks: .codeceiptignore (.projectbrainignore still
read), CODECEIPT_TOKEN / CODECEIPT_API_URL / CODECEIPT_TEST_REPORT (PROJECTBRAIN_* still read), the user config folder
codeceipt/ (the old projectbrain/ login still read until the next login), and `projectbrain` kept as a second command
name of the same bin. `codeceipt init` upgrades a Project Brain setup in place (MCP server entry, hooks, Skill,
Cursor rule, AGENTS.md section) instead of adding a duplicate; files the user edited are left and reported.
Unchanged on purpose (internal, renaming adds risk for no user benefit): @brain/* package names, database and
migration names, the Inngest app id, the session state folder inside .git, and the FEAT specs' criteria text
(they mirror agent/features.json, which is never reworded).
Revisit when: the next major CLI version (drop the projectbrain fallbacks and alias).

## D-020 | 2026-10-30 | Launch: device approval, one project per repo, Origin check, waitlist
Context: launch request (owner, 2026-10-30): `npx codeceipt` sets everything up, each repo has its own project, agents
need no environment variables, the landing waitlist saves emails.
Decision: (1) the CLI gets its token through a device approval (a short code shown in the terminal and on /device,
10 minutes, single use, polling rate limited); only a sha256 of the CLI's secret device code is stored, and the token
is minted when the approved code is collected, so no raw token is ever stored. (2) The repo's project link lives in
.git/codeceipt/project.json (project id and server only); tokens stay in the user config, keyed by server and project.
(3) Claude Code gets the token from `codeceipt mcp-headers`; Cursor (no header helper) starts `codeceipt mcp-proxy`,
a stdio proxy to /mcp. (4) Every session request that changes state must carry the app's own Origin (or Referer);
a request with neither (not a browser) passes, because only browsers attach the victim's cookie. (5) Waitlist emails
are stored trimmed and lowercased with one answer whether or not they existed; /admin/waitlist is for the GitHub
logins in ADMIN_GITHUB_LOGINS, and the login is asked from GitHub with the user's own token on each view (never
stored or editable, so a renamed or reclaimed login cannot inherit access). One migration (0029) holds both tables.
(6) The npm package codeceipt 0.1.0 has one command, `codeceipt` (the pre-release `projectbrain` alias is dropped;
`codeceipt init` upgrades hooks that still use it), defaults to https://codeceipts.vercel.app, bundles the workspace
packages and publishes only the built files and README (docs/publishing.md). `npx codeceipt` does not install the
command the agents run, so the setup summary says `npm install -g codeceipt` when it is missing.
Revisit when: a second admin page is needed (store GitHub's numeric user id instead of asking each time).
