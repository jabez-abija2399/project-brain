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
