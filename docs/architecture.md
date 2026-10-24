# Architecture: Project Brain
Written during the kickoff; updated only when the structure changes. Keep it under ~150 lines.

## Options considered (trial stage)
| Option | Cost now | Time to first deploy | Operational load | Risk | Fit for v1 scale (<100 projects) |
|---|---|---|---|---|---|
| A. One Next.js app on Vercel + Inngest jobs + Neon Postgres | ~$0 | hours | lowest | 300 s function limit on Hobby | good: jobs split into steps |
| B. Next.js + separate Hono API/worker on Render | ~$7+/mo | 1-2 days | two deploys | more moving parts | good, overkill now |
| C. Next.js on an always-on container (Render/Railway) | ~$7+/mo | 1 day | one server to babysit | no auto-scaling | good |
Chosen: **A** (D-001). Move to B or C when long jobs or paying users require it (see Stage 2 in decisions).

## Stack and why
| Part | Choice | Why | Rejected (and why) |
|---|---|---|---|
| Language / runtime | TypeScript on Node.js | one language for app, CLI, hooks; best MCP + GitHub SDKs | Python (two languages) |
| Monorepo | pnpm workspaces | share core logic between web app and CLI | Turborepo (later, not needed yet) |
| Framework | Next.js (App Router) | dashboard + API + MCP route in one deploy | React Router, SvelteKit (smaller MCP/Vercel ecosystem) |
| MCP | mcp-handler + @modelcontextprotocol/sdk | official SDK; mcp-handler runs MCP in a Next.js route | fastmcp (own server process) |
| Data store | Neon Postgres + Drizzle ORM (tests: PGlite) | plain Postgres, auto-wakes from scale-to-zero, free branches, pgvector later; typed SQL | Supabase (extras we don't use; free projects pause), Prisma (heavier engine), Kysely (no migrations) |
| Jobs | Inngest | serverless steps + retries, free tier, no worker server | Trigger.dev, QStash (both fine; Inngest has best Next.js DX) |
| Parsing | TypeScript Compiler API (MVP, D-011); web-tree-sitter + ts-morph kept for other languages later | MVP is TS/JS only; the compiler gives exact types, props and exports with no extra grammar | native tree-sitter (native build on serverless), Babel (JS only) |
| SQL / RLS | hand-written SQL reader in packages/core (MVP, D-012); libpg-query kept as fallback | only needs tables, RLS flags and policies; no native/WASM dependency | libpg-query (native/WASM build), pgsql-ast-parser, node-sql-parser (incomplete PG dialect) |
| AI | @anthropic-ai/sdk, small model | checklist + receipt wording; cheap | Vercel AI SDK (extra layer), OpenAI |
| GitHub | @octokit/app + @octokit/webhooks | official, signature verification built in | Probot (framework, own server) |
| Auth | better-auth (GitHub provider) | GitHub OAuth + OAuth provider for MCP clients | next-auth v4 (no MCP OAuth), Clerk (paid at scale, vendor lock-in) |
| Validation | zod | standard, used by MCP SDK | valibot, yup |
| UI | Tailwind CSS + shadcn/ui (copied components) | fast, accessible, no runtime dependency | UnoCSS, Panda |
| Tests / lint | Vitest (+ Playwright later), Biome, TypeScript | fast; verbose reporter prints AC ids; matches the kit's pnpm-monorepo preset | Jest, ESLint, oxlint |
| CLI | commander + @clack/prompts | mature + clean interactive prompts | citty, yargs, inquirer |
| Hosting | Vercel Hobby (trial), Neon free, Inngest free | $0 while building | Fly.io (no free tier) |

## Folder structure
```
apps/web/                  Next.js app: dashboard, API routes, MCP route, GitHub webhook, Inngest functions
  src/app/                 pages + route handlers (app/api/**, app/mcp/[transport]/route.ts)
  src/server/              server-only: auth, requireProjectAccess, services that combine core + db
  src/components/          UI (shadcn/ui copies in components/ui)
  src/inngest/             job definitions (index-push, build-receipt)
packages/core/             pure logic: indexer, feature grouping, similarity, checklist, receipt, checks, llm wrapper
packages/db/               Drizzle schema, migrations, repositories (the only code that touches Postgres)
packages/cli/              `projectbrain` CLI: init, index, hooks; talks to the API with a project token
packages/agent-kit/        templates: SKILL.md, AGENTS.md section, hook scripts, MCP config snippets
```
Layering: route/tool/job -> apps/web/src/server service -> packages/core (logic) + packages/db (data).
Import rules that the gate enforces: docs/boundaries.txt.

## Reusable building blocks (build once, every feature uses them; agents check here before writing new code)
| Block | Where | Use it for |
|---|---|---|
| requireUser / requireProjectAccess | apps/web/src/server/auth.ts | authorization in every route, MCP tool and job |
| requireProjectToken | apps/web/src/server/tokens.ts | CLI and MCP token auth (hashed tokens, scoped to one project) |
| parseInput(schema) | apps/web/src/server/validate.ts | zod validation at every entry point |
| repositories | packages/db/src/repos/* | all data access, always filtered by projectId |
| llm.complete | packages/core/src/llm.ts | the only LLM entry: model, timeout, max tokens, cost log |
| mask | packages/core/src/mask.ts | masking secrets before storing/returning/logging |
| AppError + toResponse | apps/web/src/server/errors.ts | one error shape for API and MCP |
| UI kit | apps/web/src/components/ui | Button, Badge, Card, DataTable, EmptyState, Dialog (docs/DESIGN.md) |

## Runtime picture
```
CLI (user machine) --index upload (token)--> /api/index ----------\
Agent (Claude Code/Cursor) --MCP (OAuth/token)--> /mcp ------------+--> server services --> core + db --> Neon
GitHub push --webhook (signed)--> /api/github/webhook --> Inngest job (fetch changed files via App, re-index, receipt)
Browser --session--> dashboard pages --------------------------------/
Inngest jobs --> Claude API (checklist, receipt wording only)
```

## Data model
users, sessions (better-auth tables) · projects(id, owner_id FK, name, repo_full_name UNIQUE per owner) ·
project_tokens(id, project_id FK, hash UNIQUE, created_at, revoked_at) · files(project_id, path, hash; UNIQUE project+path) ·
symbols(project_id, file_id FK, kind component|function|route|table, name, signature, summary<=200) ·
features(project_id, name UNIQUE per project, description, status) · feature_files(feature_id, file_id; PK both) ·
decisions(project_id, title, reason, created_at) · agent_sessions(project_id, goal, done, unfinished, next_step, created_at) ·
requests(project_id, feature_id, text, created_at) · checklist_items(request_id, text, status open|done|partial|missed|dismissed) ·
receipts(project_id, request_id NULL, commit_sha NULL, summary_json, created_at) ·
db_tables(project_id, file_id, name, rls_enabled) ·
db_policies(table_id, command, allows_all boolean, checks_ownership boolean).
Flags only, no policy expression text (D-002).
Indexes: every table on project_id; symbols(project_id, kind, name); receipts(project_id, created_at desc).

## Performance budget
v1: <100 projects, repos up to 2,000 files. MCP read tools p95 < 500 ms. Dashboard pages p95 < 800 ms.
First index of 500 files < 60 s (CLI, local). Incremental re-index of 10 files < 10 s. Lists paginated, max 50 rows.

## Authorization
One helper, requireProjectAccess(projectId, actor), in apps/web/src/server/auth.ts: returns the project or throws
404 (never reveal existence). Actors: session user (dashboard), project token (CLI/MCP), GitHub installation (jobs).

## Key flows
1. Local index: CLI parses files with packages/core, sends symbols/paths/hashes (no source) in batches of 200 files.
2. Push re-index: webhook verifies signature, enqueues job, job fetches only changed files, parses in memory, discards source.
3. Receipt: diff file list + checklist + feature map -> deterministic part (files by feature, out of scope, checks)
   + one small-model call to judge checklist items -> stored receipt.

## Config and environment (validated at startup)
| Name | Purpose | Secret |
|---|---|---|
| DATABASE_URL | Neon Postgres connection string (dev branch locally) | yes |
| BETTER_AUTH_SECRET / BETTER_AUTH_URL | session signing / app URL | yes / no |
| GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET | GitHub sign-in | no / yes |
| GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_WEBHOOK_SECRET | GitHub App | no / yes / yes |
| ANTHROPIC_API_KEY | Claude API | yes |
| INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY | jobs (not needed with the local dev server) | yes |

## Local development
`git clone ... && pnpm install && cp .env.example .env` (fill values) `&& bash scripts/dev.sh`
(runs migrations against your Neon 'dev' branch, starts Next.js; run `npx inngest-cli dev` in a second terminal for jobs).
No Docker: development uses a Neon 'dev' branch; tests use PGlite (in-process Postgres) so they need no database server.

## Build order
FEAT-001 skeleton -> 002 db -> 003 auth -> 004 indexer -> 005 Supabase reader -> 006 features -> 007 components ->
008 CLI index -> 009 GitHub App -> 010 sessions -> 011 MCP -> 012 checklist -> 013 receipt -> 014 packages ->
015 secrets/RLS -> 016 agent setup -> 017 dashboard -> 018 test integrity -> 019 planning (priority = build order). Accounts needed: GitHub OAuth app (003), Anthropic key (007/012), GitHub App (009),
Neon + Vercel + Inngest (first deploy).

## Deployment
Vercel (apps/web) from main; Neon Postgres main branch (drizzle-kit migrate in CI before deploy); Inngest Cloud; CLI published
to npm from packages/cli. Neon point-in-time restore window (free tier: check the restore window before real users).
