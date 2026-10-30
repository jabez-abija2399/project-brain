# AGENTS.md
<!-- PROJECT:BEGIN  (filled during the kickoff; yours to edit; `kit.py upgrade` never touches this block) -->
Project: Codeceipt (formerly Project Brain): a receipt for every AI change; a living blueprint of every AI-built app, so vibe coders can trust what agents build.
Stack: TypeScript pnpm monorepo; Next.js on Vercel (dashboard + API + MCP route + webhooks), Neon Postgres + Drizzle (tests: PGlite),
Inngest jobs, web-tree-sitter parsing, Claude API (small model), better-auth (GitHub). Start the app: `bash scripts/dev.sh`.
One test: `pnpm vitest run <path/to/file.test.ts>`
Project rules (max 10; only what the code can't tell you):
- Every API route, MCP tool and job calls requireProjectAccess(); never trust a projectId or userId sent by the client.
- Never store user source code in the database or logs: only index metadata, symbols, paths and short summaries.
- packages/core is pure TypeScript: no Next.js, no database, no network except clients passed in as arguments.
- All database access goes through packages/db repositories; all LLM calls go through packages/core/src/llm.
- MCP read tools (where_did_we_stop, get_context_pack, find_similar_component) never call an LLM: DB reads only, p95 < 500 ms.
- Secrets found in user code are masked (first 4 chars + ***) before they are stored, returned or logged.
- Webhooks verify signatures before doing any work; anything slower than 2 s runs as an Inngest job.
- Trial stack only (docs/decisions.md D-001): no separate backend servers until that decision is revisited.
- First supported target stack: React/Next.js + Supabase; first agents: Claude Code and Cursor.
- Before marking a feature done, check it against docs/build-checklist.md and write an attacker test for each rule that applies.
<!-- PROJECT:END -->

<!-- KIT:BEGIN v4.1.0  (replaced by `kit.py upgrade`; keep it short: every line here costs tokens in every session) -->
## Every session
1. Read the SESSION BRIEF (Claude Code injects it; otherwise run `python3 scripts/kit.py brief`). Obey its USER DIRECTIVES.
2. When the user states a preference or changed requirement, append one dated line to `agent/directives.md` first.
3. One feature or task per session. Workflows: skills `feature`, `bugfix`, `change`, `kickoff`, `security`, `perf`,
   `evaluate`, `peer-review`, `audit`, `prove`, `state` (in `.agents/skills/`; `/name` in Claude Code).
4. Find code with `python3 scripts/kit.py where <FEAT-x|AC-x|symbol>` and `rg -n`; open only the lines you need.
   Criteria: `kit.py show FEAT-x`. Never read agent/features.json whole.

## Hard rules (guards enforce most of them)
- Build only what the acceptance criteria require; ideas go to `agent/later.md`. Reuse before creating (where/rg).
- Before editing, list the files in `agent/scope.txt`. Commits outside it fail.
- Server-side authorization and input validation on every entry point; secrets only via env; never read .env files.
- New package: `kit.py dep-check <name>` + row in docs/dependencies.md first.
- Mark criteria only with `kit.py pass` / `kit.py done`. Never edit agent/features.json, never delete, skip or weaken
  a test, never reword a criterion (changes go through agent/plan.json + the human).
- Never say "fixed", "done" or "tests pass" unless you ran it in THIS session. Not checked = NOT VERIFIED.
- Human-only: protected files (scripts/kit.py, verify.sh, verify.config, hook files) and the override variables.
- Ask first: schema-breaking migrations, deleting files, auth changes outside the current feature, large new packages.
- Gate: `bash scripts/verify.sh --quick` while working, `bash scripts/verify.sh` once at the end.
<!-- KIT:END -->
