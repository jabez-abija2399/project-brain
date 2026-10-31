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

## D-021 | 2026-10-30 | `codeceipt init` for OpenAI Codex, OpenCode and Google Antigravity
Context: owner request (2026-10-30). Each agent's official docs were read on 2026-10-30: Codex at
learn.chatgpt.com/docs/{extend/mcp, config-file/config-reference, hooks, build-skills} (developers.openai.com/codex
now redirects there; newest CLI 0.166.0), OpenCode at opencode.ai/docs/{config, mcp-servers, plugins, rules, skills}
plus the @opencode-ai/plugin 1.19.5 types, Antigravity at antigravity.google/docs/{mcp, hooks, rules, skills}.
Decision, per agent (detection: repo folder or the agent's home folder, like Claude Code and Cursor):
- Codex (repo `.codex/`, `~/.codex`): MCP server appended to `.codex/config.toml` as `[mcp_servers.codeceipt]`
  (command `codeceipt`, args `mcp-proxy --linked-only`); hooks in `.codex/hooks.json` (`{ hooks: { Event: [group] } }`):
  `SessionStart` (plain stdout becomes developer context) and `SessionEnd`, which Codex allows 3 s at most, so the
  hook starts the same CLI detached with `--worker` and returns. Skill `.agents/skills/codeceipt/SKILL.md`; AGENTS.md.
  Cannot: Codex ignores a project `.codex/` until the user trusts the project, and asks the user to review new hooks
  in `/hooks`; SessionEnd is advisory and not guaranteed after a crash (the GitHub App still covers pushes).
  `http_headers_helper` exists but is not told which server it serves, so a cloned repo could aim it at another
  server; the stdio proxy is used instead.
- OpenCode (`opencode.json`/`.jsonc`, `.opencode/`, `~/.config/opencode`): `mcp.codeceipt` in `opencode.json`
  (`type: "local"`, `command: ["codeceipt","mcp-proxy","--linked-only"]`, `cwd: "."`, created with its `$schema` when
  missing); an `opencode.jsonc` is never rewritten (comments), init prints the entry to add. Plugin
  `.opencode/plugins/codeceipt.js`: on `session.created` it runs `codeceipt hook session-start --agent opencode` (no
  shell) and adds the note with `client.session.prompt({ noReply: true })`. Skill in `.agents/skills`; AGENTS.md.
  Cannot: no session-end event (`session.idle` fires after every answer, `session.deleted` only on delete), so no
  automatic receipt: init says to run `codeceipt receipt` or use the GitHub App.
- Antigravity (repo `.agents/rules|hooks.json|mcp_config.json`, legacy `.agent/`, `~/.gemini/antigravity`,
  `~/.gemini/config`; a lone `.agents/skills` does not count, Codex and OpenCode share it): MCP in the workspace file
  `.agents/mcp_config.json` (`mcpServers.codeceipt` = `command`/`args`, the proxy); hook named `codeceipt` in
  `.agents/hooks.json` with a `SessionStart` handler whose stdout is `{ injectSteps: [{ systemMessage: { systemMessage
  } }] }`; always-on rule `.agents/rules/codeceipt.md` (`trigger: always_on`); skill in `.agents/skills`.
  Cannot: no session-end event (`Stop` fires when each execution ends), so `codeceipt receipt` or the GitHub App;
  MCP headers are static (no helper); the docs do not say which folder hooks and stdio servers run in, so the hook
  takes the repo from `workspacePaths`; whether the Antigravity App (not IDE/CLI) reads `.agents/mcp_config.json` is
  not documented.
Common: the three agents start `codeceipt mcp-proxy --linked-only` and their hooks run with linked-only: outside a
repo linked to a project they use no token at all (never the default login). New: `codeceipt receipt` runs the
session end by hand, from the newest session start recorded in the repo (else the last commit). The skill and rule
add "stay in scope" to the existing workflow; the Claude Code and Cursor texts stay byte-identical so older installs
are still recognised.
Hardening after the fresh-context security pass: an existing `codeceipt` entry counts as ours only when it is exactly
what init writes (or our older HTTP form for the same server); Codex's config.toml is read skipping comments and
multi-line strings, and any other definition of mcp_servers.codeceipt (quoted keys, dotted keys, inline tables,
sub-tables, extra keys) is reported, never appended to; a hook command is ours only bare or with an absolute path (a
repo cannot know where it is cloned, so it cannot plant one); a skill, rule or plugin file counts as set up only when
identical to ours; Codex gets the note inside `hookSpecificOutput.additionalContext` so a note can never act as hook
control.
Revisit when: OpenCode or Antigravity add a session-end event, or Codex lets a header helper see its server URL.

## D-022 | 2026-10-30 | First receipt: setup files left out; "Done, no test proves it" apart from "Not verified"
Context: owner request (2026-10-30) after the first-time journey work: a user's first receipt listed the files
`npx codeceipt` added as changes outside the request, and "not verified" mixed two different things.
Decision: (1) the files `codeceipt init` writes (.mcp.json, .claude/settings.json, .claude/skills/codeceipt,
.cursor/{mcp,hooks}.json and rules/codeceipt.mdc, .codex/{config.toml,hooks.json}, opencode.json,
.opencode/plugins/codeceipt.js, .agents/{mcp_config,hooks}.json, rules/codeceipt.md and skills/codeceipt) are never a
receipt's changed files or outside scope: the CLI leaves them out (the secret scan still reads them) and the server
drops them too. AGENTS.md counts only when something besides the Codeceipt section changed (the CLI compares it
without the section). Only these exact paths: the user's own rules, skills and settings in the same folders still
count. (2) An item judged done with file evidence but no changed test gets the status `done_untested` ("Done, no test
proves it"); "Not verified" is only what Codeceipt could not check (no file evidence, prompt caps). AC-013-07 still
holds: such an item stays listed in the receipt's not_verified data with the reason "no test changed" and is never
stored or shown as plain done; receipts stored before the split show the same way.
Revisit when: the owner rewords AC-013-07 to name the two states (criteria change through agent/plan.json).

## D-023 | 2026-10-30 | Dogfooding fixes: features by name, receipts without a request, `codeceipt last`, tests group
Context: dogfooding on a real project (edutech, owner, 2026-10-30): create_checklist failed for feature "home" shown by
name in the start note; a session that changed src/app/page.tsx without a checklist produced no receipt; the
session-end summary was not visible after Claude Code exited; test folders became features.
Decision: (1) every MCP tool that takes a feature (create_checklist, get_context_pack) accepts its name, key or id
(resolved in that order, only in the token's project); list_features and the start note show each id; a wrong one
is an MCP not-found error naming the project's features (data.valid_features, at most 50). create_checklist takes
`feature` (the older `featureId` still works). (2) generate_receipt's requestId is optional: a session with changed
files always gets a receipt (files by feature, outside scope, secrets, RLS, test checks, no AI call) marked
no_request, shown as "No request was recorded for this session, so nothing could be checked against what you asked."
The hook still uses the newest open request when one exists. (3) Claude Code's hooks reference (checked 2026-10-30):
SessionEnd "Shows stderr to user only", stdout goes to the debug log, its JSON output (systemMessage) is discarded,
and hooks have no terminal; nothing shows reliably after exit. So `codeceipt last` (GET
/api/hooks/:projectId/last-receipt, token-scoped) prints the latest receipt's summary and link, and the setup's
"What happens next" names it. (4) Files in __mocks__, __tests__, __fixtures__, fixtures, test, tests, e2e, cypress or
playwright (anywhere in the path) go to one "tests" group (key @tests); tests never pull app code into it, and a test
file is never "outside" the request in a receipt.
Revisit when: Claude Code shows SessionEnd output after exit; requests are tied to the session that created them.

## D-024 | 2026-10-30 | Requests captured by prompt-submit hooks, tied to sessions; the session-end hook exits 0
Context: a real test on edutech (owner, 2026-10-30): requests were recorded only when the agent remembered to call
create_checklist; an old open request was judged against a new session's changes; Claude Code printed "SessionEnd
hook ... failed:" above the receipt summary because the hook exited 2.
Decision: (1) `codeceipt init` installs each agent's prompt-submit hook (docs checked 2026-10-30): Claude Code
UserPromptSubmit and Codex UserPromptSubmit (stdout is added to the model's context, so the hook prints nothing),
Cursor beforeSubmitPrompt (answers {"continue":true}, never blocks), OpenCode's plugin "chat.message" event (reads the
text parts, never changes them). Antigravity documents no prompt event, so its agent keeps calling create_checklist.
The hook returns at once and records in the background: `codeceipt hook prompt --worker` masks secrets, caps the text
at 4000 characters and POSTs it with the agent's session id to /api/hooks/:projectId/requests (project token). Empty
prompts, slash commands and Codeceipt's own commands are never sent. The server makes at most 1 AI call (purpose
request-capture, counted in the daily budget): "NOT A REQUEST" stores nothing, otherwise the request is stored on the
named feature (only one of the project's) with its checklist items; with the budget used up it is stored unsplit. The
user's text is a labelled data block the model is told not to follow. Same text in the same session within 24 h is
stored once, and create_checklist for a captured request returns it with no second AI call. (2) requests.session_id
(migration 0032). The session-end hook asks open-items for `?session=<id>&since=<session start>`; a receipt checks
only that session's requests (a request without a session, from create_checklist, counts when created after the
session started); with none, the receipt is a no-request receipt. Older open items are shown in the start note as
"STILL OPEN FROM EARLIER:" and never judged against a new session. (3) Claude Code's hooks reference: SessionEnd output
is shown only as stderr, JSON output is discarded, and any non-zero exit is labelled failed. The hook now always exits
0 and keeps the summary on stderr (whether Claude Code shows stderr for exit 0 depends on its version; `codeceipt last`
prints it again). The summary's first line says how many files changed.
Revisit when: Antigravity documents a prompt event; Claude Code adds a way to show a hook message without a status.
Security pass (fresh context, 2026-10-30): only a short summary of a captured message is stored (masked, pasted code
blocks replaced by "[code omitted]", at most 500 characters; the AI still sees the masked message); acknowledgements
("ok", "continue", "thanks") are skipped with no AI call; stored captures are capped per project per day
(REQUEST_CAPTURES_PER_PROJECT_PER_DAY, default 500) so a token cannot fill the database once the AI budget is used;
create_checklist reuses a captured request only when it already has items; the prompt hook ignores a folder on stdin
that is in a different repo from the one it runs in; and the start note labels "STILL OPEN FROM EARLIER" as the user's
earlier requests, quoted as data, to confirm with the user before acting on them.

## D-025 | 2026-10-31 | Session snapshot, code-free change summaries, "missed" needs evidence, questions are not tasks
Context: a real test on edutech (owner, 2026-10-31): a receipt counted files the user had changed before the session
(prisma/schema.prisma, src/lib/offline/sync.ts, an untracked db_dump.json) as the agent's and flagged them outside the
request; "Add a comment at the top of the main page" was marked missed although src/app/page.tsx changed, because the
judge saw only paths; a clarifying question was counted as a missed task.
Decision: (1) The session-start hook records a snapshot of the working tree in the session's state file inside .git:
every modified or untracked file with a SHA-256 of its content (symlinks by target), paths and hashes only. At session
end a file counts only when it is new since the snapshot or its hash differs; one that was already modified and
changed further counts and is sent as preExistingFiles ("already modified before the session" on the receipt). The
same filtered list feeds the secret scan and the test checks. No snapshot (an older CLI, no start hook, more than
20,000 changed files, or a malformed state file) falls back to every changed file and the receipt and the terminal
say so (snapshot: "missing", no_snapshot). (2) The CLI sends a change summary per file, computed locally from git's
diff: lines added and removed, comment-only, imports changed, top-level symbols added, removed or changed by name
(masked), and places (top of file, lines N-M, end of file, new or deleted file). Never source text (D-002): the
server accepts only counts, identifier-shaped names and that fixed set of places, for changed files only. The judge
gets these summaries and may answer unclear. "Missed" stands only when every changed file was shown with a summary;
otherwise, and for unclear or unanswered items, the item is "Done, no test proves it" when the judge cited an
in-scope file and no test changed, else "Not verified" (not enough evidence to judge). A receipt with no changed files
still reports every task missed (AC-013-05). (3) Items flagged needs_clarification are questions: never judged,
never missed, shown as "Question", left out of "Send fix to agent". The splitter and request capture ask only when
something cannot be built without guessing; a wording question next to a clear item is dropped.
Revisit when: the judge needs more than names and counts (for example a feature's own test results).
Security pass (fresh context, 2026-10-31): a judge's "missed" with a file lacking a summary becomes not verified,
never done (only an explicit done, or unclear citing an in-scope file, can give "Done, no test proves it"); binary,
large (over 1 MB, or a diff over 2 MB) and symlinked files get a kind-only summary ("binary file", "large file",
"symlink"), so one image does not remove the evidence; hashing has a 256 MB budget (no snapshot past it at the start,
and at the end files past it count as changed); the state is written before hashing; files already modified before
the session are labelled for the judge. Kept as the owner asked: the snapshot also filters the secret scan, so a
snapshot edited by an agent with write access to .git could hide a file (as the starting commit already could); see
agent/later.md.
Owner decision (2026-10-31): the secret scan reads every changed file, whatever the snapshot says (fail safe).
Findings in files untouched since the snapshot are sent as secretFindingsBeforeSession (the server refuses any that
name a file in this change) and shown in a separate section, "Already in your working tree before this session",
never counted as the agent's change, in the findings count or outside scope. A snapshot edited to hide a file can
therefore move its secrets to that section, but never hide them. The snapshot still applies to the receipt's changed
files and the test checks.

## D-026 | 2026-10-31 | Checklist items are outcomes; evidence for files changed before the session; receipt page size
Context: a real test on edutech after PR #22: "Add a comment at the top of the main page explaining what it shows."
became 4 items with steps like "Find the main page file"; 8 comment-only lines added at the top of src/app/page.tsx
came out "not enough evidence to judge"; older receipts showed empty bullets; a click on the receipts page took 416 ms.
Decision: (1) Items are outcomes the user would check, never steps or implementation rules (shared prompt rule for the
splitter and request capture; lines starting with find, locate, open, read, keep, do not, follow and similar are
dropped). A short single-purpose request (one sentence, at most 25 words, no "and"/"also"/";"/line breaks) is exactly
one item in the user's words, whatever the model answers; its real questions stay. (2) Traced end to end through the
real session hooks and routes: the summaries reached the judge intact for a clean file, but when the file was already
modified before the session, it was diffed against the starting commit, so the user's earlier edits buried the
session's 8 comment lines. Now session start also writes each already-modified file (up to 500, 1 MB each) into git's
own object store (`git hash-object -w`, local, never sent), and session end diffs that start blob against the file
(since_session_start), so the summary covers this session's edits only. The judge prompt says it never sees the code
and judges by the kind and place of a change. Receipts store the code-free evidence the judge was given per file
(evidence), and note when the CLI sent no summaries at all (no_change_summaries, an older codeceipt);
`codeceipt last --evidence` prints both. (3) The receipt view never passes the card an entry without visible text,
and reads older shapes (plain-text entries, camelCase keys, a group without a feature name). (4) Measured in Chromium
(4x CPU slowdown, 50 receipts): every closed card carried its whole body (54,000 nodes, 2.4 MB), and a click on a
summary took 192 ms of style and layout. A closed card now renders only its summary; its body is rendered on first
open (2,262 nodes, 109 KB, 48 ms).
Revisit when: the judge needs more than kinds and places (for example the test results of a feature).
Security pass (fresh context, 2026-10-31): the step filter drops only navigation steps (find, open, read...) and
general code-style rules (keep the existing code unchanged, follow the style); a constraint the user asked for ("do not
store passwords in plain text", "keep the admin page behind login") is an outcome and stays, and the prompt says so.
"with" also marks a request as naming a second thing. The server masks symbol names again and cleans and masks paths
before storing per-file evidence (a raw path had reached the response). Start blobs are used only when git reports a
blob whose content hash matches the snapshot (a blob planted in the state file is ignored), and at most 64 MB is
written as start blobs.
