# Approved dependencies
Every entry was checked with `python3 scripts/kit.py dep-check <name>` (exists, age, maintenance, downloads, license),
and compared with 2 alternatives. Install these without a new entry. Anything else: dep-check it and 2 alternatives ->
add a row here -> install. Prefer a well-known package over writing the code yourself.
New versions are only installed once they are 7 days old (dependency cooldown: `python3 scripts/kit.py harden`; D-013).
(The pre-commit hook and the Claude Code hook block packages that are not listed here or in docs/decisions.md.)

**Cooldown: package versions younger than 7 days are never installed (`minimumReleaseAge: 10080` in pnpm-workspace.yaml; raised from the `kit.py harden` default of 3 days, see D-013). Security fixes may bypass it only with human approval. Only the human can change it, with GUARD_ADMIN=1.**

| Package | Where | Purpose | Alternatives considered (why not) | License | Checked |
|---|---|---|---|---|---|
| next | apps/web | framework: pages, API routes, MCP route | react-router (no API/MCP hosting story), @sveltejs/kit (smaller ecosystem) | MIT | 2026-10-23 |
| react, react-dom | apps/web | UI runtime (installed with next) | (required by next) | MIT | 2026-10-23 |
| @modelcontextprotocol/sdk | apps/web | MCP protocol types/server | fastmcp (separate server process; release 0 days old) | MIT | 2026-10-23 |
| mcp-handler | apps/web | MCP over HTTP inside a Next.js route | fastmcp (own server), hand-written transport (risky) | Apache-2.0 | 2026-10-23 |
| @modelcontextprotocol/server | apps/web | MCP v2 server types and errors (McpServer, AuthInfo, ProtocolError) used by mcp-handler 2.x; pinned to the copy mcp-handler resolves, so there is one SDK | @modelcontextprotocol/sdk v1 (mcp-handler 2.x no longer uses it; two SDKs in one app), fastmcp (own server process, 1 maintainer, release 1 day old) | Apache-2.0 | 2026-10-28 |
| drizzle-orm | packages/db | typed queries | prisma (heavy engine; latest is an rc), kysely (no migrations) | Apache-2.0 | 2026-10-23 |
| drizzle-kit | packages/db (dev) | migrations | prisma migrate, raw SQL files | MIT | 2026-10-23 |
| postgres | packages/db | Postgres driver (postgres.js; works with Neon over TCP) | pg (more boilerplate), @neondatabase/serverless (HTTP driver; consider if Vercel cold-start latency matters) | Unlicense | 2026-10-23 |
| @electric-sql/pglite | packages/db (dev) | in-process Postgres for tests (no Docker, works in CI) | pg-mem (emulator, misses real Postgres behavior), testcontainers (needs Docker) | Apache-2.0 | 2026-10-23 |
| @electric-sql/pglite | packages/sandbox (production; FEAT-005 sandbox, D-014) | run users' Supabase migrations in a disposable in-memory Postgres in a child process to read the real RLS state; pinned to 0.5.10: newest version past the 7-day cooldown (D-013) on 2026-10-26 (0.5.11 is from 2026-10-21); packages/db keeps 0.2.x for tests until KI-001 | static replay with libpg-query (fails open on dynamic SQL, review 2026-10-26), real Postgres per scan via Neon branch or Docker (network, cost, no Docker D-007) | Apache-2.0 | 2026-10-26 |
| inngest | apps/web | background jobs with steps/retries | @trigger.dev/sdk, @upstash/qstash (both fine; Inngest best Next.js DX) | Apache-2.0 | 2026-10-23 |
| web-tree-sitter | packages/core (not used yet; FEAT-004 uses the TypeScript Compiler API — D-011) | WASM code parser (works on Vercel); kept approved for when we add non-TS languages | tree-sitter (native build), @babel/parser (JS/TS only, no other languages later) | MIT | 2026-10-23 |
| @vscode/tree-sitter-wasm | packages/core | prebuilt TS/TSX/JS grammars | tree-sitter-wasms (last release 1 year ago), build grammars ourselves | MIT | 2026-10-23 |
| ts-morph | packages/core (not used yet; FEAT-004 uses the TypeScript Compiler API directly — D-011) | TS exports, props, types | typescript compiler API directly (verbose), @swc/core (no type info) | MIT | 2026-10-23 |
| libpg-query | packages/core (FEAT-005 Supabase reader — D-012 update 2026-10-24) | parse Supabase SQL migrations + RLS policies with the real Postgres parser; pinned to 18.1.5: newest version past the 7-day cooldown (D-013) on 2026-10-24; prebuilt WASM, no install script, no native build | pgsql-ast-parser, node-sql-parser (incomplete Postgres dialect) | MIT | 2026-10-24 |
| @anthropic-ai/sdk | apps/web (client passed to packages/core llm) | Claude API (checklists, receipts, summaries) | ai (extra abstraction), openai (different provider) | Apache-2.0 | 2026-10-23 |
| @octokit/app | apps/web | GitHub App auth + API | octokit (all-in-one, larger), probot (framework + own server) | MIT | 2026-10-23 |
| @octokit/webhooks | apps/web | webhook signature verification + types | probot, hand-written HMAC check (risky) | MIT | 2026-10-23 |
| better-auth | apps/web | GitHub sign-in + OAuth provider for MCP | next-auth v4 (no MCP OAuth), @clerk/nextjs (paid at scale, lock-in) | MIT | 2026-10-23 |
| zod | all | input validation, MCP tool schemas | valibot (smaller ecosystem), yup (less TS-native) | MIT | 2026-10-23 |
| tailwindcss | apps/web | styling with tokens | unocss, @pandacss/dev (smaller ecosystems) | MIT | 2026-10-23 |
| ignore | packages/core | .gitignore semantics for the indexer walker (anchored patterns, negation, dir-only, nested files); pinned to 7.0.12: newest version past the 7-day cooldown (D-013) on 2026-10-24 | minimatch, picomatch (generic glob matchers: no gitignore negation/anchoring/last-match-wins rules, we would re-implement them) | MIT | 2026-10-24 |
| vitest | all (dev) | unit/integration tests, verbose names | jest (slower, ESM friction), mocha (more setup) | MIT | 2026-10-23 |
| esbuild | packages/cli (dev) | bundle the CLI and @brain/core into one runnable `projectbrain` bin (dist/projectbrain.mjs; KI-023 session 2026-10-28); pinned to 0.28.2: released 2026-08-08, past the 7-day cooldown (D-013), already in the lockfile via vite | tsup (wraps esbuild, extra dep), tsc emit (core imports .ts without extensions and needs path rewriting; no bundling) | MIT | 2026-10-28 |
| @playwright/test | apps/web (dev) | browser checks for UI criteria (/evaluate) | cypress (heavier), puppeteer (no test runner) | Apache-2.0 | 2026-10-23 |
| @biomejs/biome | root (dev) | lint + format (the pnpm-monorepo verify preset runs `pnpm biome ci .`) | eslint (slower, more config), oxlint (lint only, no formatter) | MIT OR Apache-2.0 | 2026-10-23 |
| typescript | all (dev) | typecheck | (no real alternative) | Apache-2.0 | 2026-10-23 |
| commander | packages/cli | CLI commands/args | citty (pre-1.0), yargs (heavier API) | MIT | 2026-10-23 |
| @clack/prompts | packages/cli | interactive setup prompts | inquirer (heavier), prompts (unmaintained: last release 2021) | MIT | 2026-10-23 |
| @brain/core | apps/web, packages/sandbox, packages/cli | workspace package (pure logic; the CLI indexes locally with it); packages/sandbox imports only the sandbox run types (type-only; core has @brain/sandbox as a dev dependency for its tests) | n/a — internal workspace package | internal | 2026-10-23 |
| @brain/db | apps/web | workspace package (data access) | n/a — internal workspace package | internal | 2026-10-23 |
| @brain/cli | apps/web (dev) | workspace package; apps/web tests drive `projectbrain index` end to end against the real /api/index handlers | n/a — internal workspace package | internal | 2026-10-28 |
| @types/node | all (dev) | Node type definitions | required by typescript when targeting Node runtimes | MIT | 2026-10-23 |
| @types/react | apps/web (dev) | React type definitions | required by react typecheck | MIT | 2026-10-23 |
| @types/react-dom | apps/web (dev) | ReactDOM type definitions | required by react-dom typecheck | MIT | 2026-10-23 |

Notes from dep-check (2026-10-23): inngest, @anthropic-ai/sdk, better-auth, @biomejs/biome and @electric-sql/pglite published a release in the last 0-2 days;
the cooldown (`kit.py harden`) makes the installer pick an older version. Weekly download counts were not reachable
from the planning environment; re-run dep-check locally if you want them.
shadcn/ui is not a dependency: its components are copied into apps/web/src/components/ui by its CLI (run once with npx).
GitHub REST calls (fetching changed file contents in the FEAT-009 job) use the authenticated Octokit instance returned by `@octokit/app` (`app.getInstallationOctokit(installation_id)`); no separate `@octokit/rest` entry is needed.

Binaries / services (not from a package registry): Neon (hosted Postgres: 'dev' branch for development, main branch or a separate project for production),
Vercel (hosting), Inngest Cloud + `npx inngest-cli dev` (local job runner), GitHub OAuth app + GitHub App, Anthropic API.
