# Performance baselines and budgets

Every later PR re-measures against these numbers. "Tokens" are estimated as characters / 4 (no tokenizer
dependency); the same estimate is used everywhere so numbers stay comparable. Machine for local numbers: the build
sandbox, 4 cores, Node 22. Measured 2026-11-06 on main `61d0d79` unless a row says otherwise.

## 1. Verifying this repository

### CI (GitHub Actions, `verify` workflow, single job)

Run 42004579628 on main (2026-11-05, 09:42–10:09 UTC): **27 min 28 s** for the job.

| Step | Time |
|---|---|
| Set up job + Postgres container | 14 s |
| Checkout, kit guard, zizmor, detect stack | 7 s |
| pnpm, Node, Python, Go setup | 25 s |
| Install dependencies | 2 s |
| Install security scanners (pinned) | 1 min 46 s |
| **Verify gate** (`scripts/verify.sh`, all steps incl. CI-only build, e2e, audit, scanners) | **24 min 49 s** |

The gate does not print per-step times on main (that needs the owner-pending `scripts/verify.sh`, Phase 1), so the
breakdown inside it comes from the local table below.

### Local, per step (main's `scripts/verify.config` commands, run one at a time)

| Step | Time | Notes |
|---|---|---|
| typecheck (`pnpm -r typecheck`) | 16 s | all packages |
| lint (`pnpm biome ci .`) | 2 s | |
| tests: `packages/core` | 3 min 33 s | includes the indexer perf test |
| tests: `packages/db` | 1 min 24 s | migrations run for every test database |
| tests: `packages/cli` | 38 s | |
| tests: `packages/sandbox` | 22 s | |
| tests: `packages/agent-kit`, `packages/agent-plugins` | 1 s each | |
| tests: `apps/web` | **14 min 35 s** | 100 files, 884 tests, files run one at a time |
| kit guard (`kit.py check`) | 3 s | |
| **Sum (serial)** | **≈ 21 min** | build, e2e, audit and scanners are CI-only |

Packages were run one after another, so the sum is what a serial `verify.sh` costs locally. The web suite is about
70% of it.

Earlier measurements on PR #55's branch (2026-11-05, same machine type): `apps/web` tests 18 min 08 s serial;
`packages/db` tests 118 s. Phase 1 reports its results against this section.

## 2. Codeceipt's footprint in an agent session

Scripts and raw results for the rows below are reproducible with the methods listed; the measuring harness ran
`initialize` + `tools/list` through the real `/mcp` route on PGlite.

### Tokens added at session start (Claude Code)

| What | Characters | ≈ Tokens | Budget |
|---|---|---|---|
| MCP tool definitions (11 tools, full `tools/list` result) | 10,247 | 2,560 | no larger than this baseline |
| Start note (realistic project, server path) | 1,493 | 373 | ≈ 500 tokens, priority order |
| Claude Code skill frontmatter (loaded at start) | 208 | 52 | — |
| **Total at start** | **≈ 11,950** | **≈ 2,990** | — |
| AGENTS.md section written by `codeceipt init` (if the agent loads AGENTS.md) | 818 | 205 | — |

Per tool (name + description + input schema): where_did_we_stop 395, get_context_pack 484, find_similar_component
478, list_features 365, save_progress 461, add_decision 339, create_checklist 779, plan_project 1,152,
propose_checklist_change 613, **generate_receipt 4,059**, check_package 627 (total 9,752).

Start note: server cap 1,500 chars (`HANDOFF_LIMIT`, `packages/core/src/handoff.ts`), owner rules up to 1,000;
CLI clamp 4,000. A realistic project already reaches the cap; the feature list with ids takes about 600 chars and
only 3 of 5 decisions fit. Empty project: 132 chars.

Context pack (on request, not at start): cap 8,000 chars; realistic feature (25 files, 15 components, 5 decisions,
3 rules) 3,665 chars ≈ 916 tokens. Built per request; nothing precomputed or cached.

### MCP read latency (in-process, PGlite, 40 calls)

| Tool | p95 | Budget |
|---|---|---|
| where_did_we_stop | 23.7 ms | < 150 ms |
| get_context_pack | 26.6 ms | < 150 ms |
| find_similar_component | 13.5 ms (16.5 ms over 2,001 components) | < 150 ms |

Method: `cd apps/web && pnpm vitest run src/app/mcp/mcp.test.ts -t "AC-011-05"` (prints `[perf]`). Production adds
network and Neon latency, not measured here.

### Hooks and CLI commands (wall clock, median of 5, temp HOME and git repo)

| Command | Node bundle (0.3.3) | Native binary | Budget |
|---|---|---|---|
| `codeceipt --version` | 519 ms | 276 ms | — |
| `codeceipt help` | 509 ms | 276 ms | — |
| `codeceipt doctor` (logged out, reaches server) | 1,098 ms | 958 ms | — |
| `hook session-start` (not linked / server unreachable) | 565 / 593 ms | 316 / 302 ms | < 300 ms reachable; ≤ 2 s offline |
| `hook stop` (not linked / unreachable) | 532 / 599 ms | 283 / 310 ms | < 200 ms, no AI |
| `hook prompt` (not linked / unreachable) | 521 / 549 ms | 295 / 269 ms | never blocks |

Baseline `node -e 0`: 36 ms. Most of the Node bundle's time is loading the bundle, before any network call. A
refused connection fails fast; a server that accepts but never answers would wait for the 8 s session-start timeout
(not measured). Not measured: session-start with a reachable server and a linked repo (needs a running server; Phase
2 adds a timing test with a local fake server).

**Gaps against the budgets:** every hook is over its budget on the Node bundle (≈ 0.5 s of startup), and stop
(283–310 ms) and session-start (≈ 300 ms) are at or over budget on the native binary even without network work. The
tool definitions (≈ 2,560 tokens, 40% of them `generate_receipt`) are the largest part of the start cost. Phase 2
addresses both.

## 3. Phase 1 results (fast verification, 2026-11-06)

Same machine, same day as the baseline. All 884 web tests and 82 db tests pass in every run.

| What | Baseline | After | Change |
|---|---|---|---|
| `apps/web` tests | 14 min 35 s (files one at a time) | **5 min 21 s** (migrated database image, 4 workers) | 2.7× faster |
| `apps/web` tests, 2 workers | — | 6 min 33 s | 4 workers kept |
| `packages/db` tests | 1 min 24 s | 1 min 12 s (migrated image) | |
| Full local gate (`verify.sh`, CI-only steps excluded) | ≈ 21 min (sum of steps) | **10 min 38 s** with the owner-pending script | 2× faster |
| `--quick` on the Phase 1 branch (4 changed packages: web, cli, db, sandbox) | — | 8 min 12 s | tests of changed packages only |
| `--quick`, docs-only change | full typecheck + tests | kit guard only (≈ 3 s) | |

`--quick` costs what the changed packages' own tests cost: about 5.5 min when `apps/web` changed, 1–1.5 min for
`packages/db`, 40 s for `packages/cli`, 25 s for `packages/sandbox`, 3.5 min for `packages/core`. The CI number
depends on the owner-pending parallel workflow (owner action 5); the slowest job is expected to be the web tests plus
setup, about 7 min, against 27.5 min today. It will be measured on its first run.

Not done here: running package test suites in parallel inside one local gate (needs `scripts/verify.config`, protected;
noted in `agent/later.md`).
