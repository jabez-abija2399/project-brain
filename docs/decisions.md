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
