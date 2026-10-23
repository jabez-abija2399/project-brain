# Approved dependencies
Every entry was checked with `python3 scripts/kit.py dep-check <name>` (exists, age, maintenance, downloads, license),
and compared with 2 alternatives. Install these without a new entry. Anything else: dep-check it and 2 alternatives ->
add a row here -> install. Prefer a well-known package over writing the code yourself.
New versions are only installed once they are a few days old (dependency cooldown: `python3 scripts/kit.py harden`).
(The pre-commit hook and the Claude Code hook block packages that are not listed here or in docs/decisions.md.)

**Cooldown: package versions younger than 3 days are never installed (set by `python3 scripts/kit.py harden`, default 3 days). Only the human can change it, with GUARD_ADMIN=1.**

| Package | Where | Purpose | Alternatives considered (why not) | License | Checked |
|---|---|---|---|---|---|
| next | apps/web | framework: pages, API routes, MCP route | react-router (no API/MCP hosting story), @sveltejs/kit (smaller ecosystem) | MIT | 2026-10-23 |
| react, react-dom | apps/web | UI runtime (installed with next) | (required by next) | MIT | 2026-10-23 |
| @modelcontextprotocol/sdk | apps/web | MCP protocol types/server | fastmcp (separate server process; release 0 days old) | MIT | 2026-10-23 |
| mcp-handler | apps/web | MCP over HTTP inside a Next.js route | fastmcp (own server), hand-written transport (risky) | Apache-2.0 | 2026-10-23 |
| drizzle-orm | packages/db | typed queries | prisma (heavy engine; latest is an rc), kysely (no migrations) | Apache-2.0 | 2026-10-23 |
| drizzle-kit | packages/db (dev) | migrations | prisma migrate, raw SQL files | MIT | 2026-10-23 |
| postgres | packages/db | Postgres driver (postgres.js; works with Neon over TCP) | pg (more boilerplate), @neondatabase/serverless (HTTP driver; consider if Vercel cold-start latency matters) | Unlicense | 2026-10-23 |
| @electric-sql/pglite | packages/db (dev) | in-process Postgres for tests (no Docker, works in CI) | pg-mem (emulator, misses real Postgres behavior), testcontainers (needs Docker) | Apache-2.0 | 2026-10-23 |
| inngest | apps/web | background jobs with steps/retries | @trigger.dev/sdk, @upstash/qstash (both fine; Inngest best Next.js DX) | Apache-2.0 | 2026-10-23 |
| web-tree-sitter | packages/core | WASM code parser (works on Vercel) | tree-sitter (native build), @babel/parser (JS/TS only, no other languages later) | MIT | 2026-10-23 |
| @vscode/tree-sitter-wasm | packages/core | prebuilt TS/TSX/JS grammars | tree-sitter-wasms (last release 1 year ago), build grammars ourselves | MIT | 2026-10-23 |
| ts-morph | packages/core | TS exports, props, types | typescript compiler API directly (verbose), @swc/core (no type info) | MIT | 2026-10-23 |
| libpg-query | packages/core | parse Supabase SQL migrations + RLS policies | pgsql-ast-parser, node-sql-parser (incomplete Postgres dialect) | MIT | 2026-10-23 |
| @anthropic-ai/sdk | packages/core | Claude API (checklists, receipts, summaries) | ai (extra abstraction), openai (different provider) | Apache-2.0 | 2026-10-23 |
| @octokit/app | apps/web | GitHub App auth + API | octokit (all-in-one, larger), probot (framework + own server) | MIT | 2026-10-23 |
| @octokit/webhooks | apps/web | webhook signature verification + types | probot, hand-written HMAC check (risky) | MIT | 2026-10-23 |
| better-auth | apps/web | GitHub sign-in + OAuth provider for MCP | next-auth v4 (no MCP OAuth), @clerk/nextjs (paid at scale, lock-in) | MIT | 2026-10-23 |
| zod | all | input validation, MCP tool schemas | valibot (smaller ecosystem), yup (less TS-native) | MIT | 2026-10-23 |
| tailwindcss | apps/web | styling with tokens | unocss, @pandacss/dev (smaller ecosystems) | MIT | 2026-10-23 |
| vitest | all (dev) | unit/integration tests, verbose names | jest (slower, ESM friction), mocha (more setup) | MIT | 2026-10-23 |
| @playwright/test | apps/web (dev) | browser checks for UI criteria (/evaluate) | cypress (heavier), puppeteer (no test runner) | Apache-2.0 | 2026-10-23 |
| @biomejs/biome | root (dev) | lint + format (the pnpm-monorepo verify preset runs `pnpm biome ci .`) | eslint (slower, more config), oxlint (lint only, no formatter) | MIT OR Apache-2.0 | 2026-10-23 |
| typescript | all (dev) | typecheck | (no real alternative) | Apache-2.0 | 2026-10-23 |
| commander | packages/cli | CLI commands/args | citty (pre-1.0), yargs (heavier API) | MIT | 2026-10-23 |
| @clack/prompts | packages/cli | interactive setup prompts | inquirer (heavier), prompts (unmaintained: last release 2021) | MIT | 2026-10-23 |

Notes from dep-check (2026-10-23): inngest, @anthropic-ai/sdk, better-auth, @biomejs/biome and @electric-sql/pglite published a release in the last 0-2 days;
the cooldown (`kit.py harden`) makes the installer pick an older version. Weekly download counts were not reachable
from the planning environment; re-run dep-check locally if you want them.
shadcn/ui is not a dependency: its components are copied into apps/web/src/components/ui by its CLI (run once with npx).
GitHub REST calls (fetching changed file contents in the FEAT-009 job) use the authenticated Octokit instance returned by `@octokit/app` (`app.getInstallationOctokit(installation_id)`); no separate `@octokit/rest` entry is needed.

Binaries / services (not from a package registry): Neon (hosted Postgres: 'dev' branch for development, main branch or a separate project for production),
Vercel (hosting), Inngest Cloud + `npx inngest-cli dev` (local job runner), GitHub OAuth app + GitHub App, Anthropic API.
