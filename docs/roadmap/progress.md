# Roadmap progress

Source: [autonomous-plan.md](autonomous-plan.md). Re-read both files at the start of every session and continue from
the first item that is not merged or blocked. Never redo merged work. Owner actions: [../owner-actions.md](../owner-actions.md).

Status values: not started, in progress, merged, blocked (with reason).

| # | Phase / track | Status | PR | Result |
|---|---|---|---|---|
| 0 | Audit: kit migration map, baselines | merged | [#57](https://github.com/jabez-abija2399/project-brain/pull/57) | Baselines: CI 27.5 min, local ≈ 21 min (web tests 14.6 min); ≈ 2,990 tokens at session start; hooks 0.3–0.6 s |
| 1 | Fast verification (supersedes PRs #51, #53, #55) | merged | [#58](https://github.com/jabez-abija2399/project-brain/pull/58) | Web tests 14.6→5.4 min; full local gate ≈21→10.6 min; CI 27.5→14 min from faster tests alone; parallel workflow waits on owner action 5 |
| 2a | Footprint: start note budget, compact MCP tools, cached context packs (server) | merged | [#59](https://github.com/jabez-abija2399/project-brain/pull/59) | tools/list 10,247→5,754 chars; ≈2,990→1,870 tokens at start; context pack p95 26.6→14.1 ms; migration 0051 optional (owner action 6) |
| 2b | Footprint: cached start note, fast hooks (CLI) | merged | [#60](https://github.com/jabez-abija2399/project-brain/pull/60) | Hooks 520–600 ms → 70–120 ms (Node), ≈ 300 → 135–165 ms (native); offline start note ≤ 1.6 s with a saved note; CLI 0.3.5 (owner action 8) |
| 3a | Blueprint: versioned model, EARS criteria, proof status, flags | in progress | | Migration 0054 optional (owner action 9); `propose_blueprint` MCP tool; tools/list 6,479 chars (budget 6,500) |
| 3b | Blueprint: Discover, interview, safety check | in progress | | |
| 3c | Blueprint: web views (Simple/Detailed), fixtures acceptance | not started | | |
| 4 | Follow the Blueprint: start note, definition of done, prove it, done gate, receipts, review-first | not started | | |
| 5 | Guard: pre-tool-use boundaries, `codeceipt guard --staged/--ci` | not started | | |
| 6 | Approval policies | not started | | |
| 7 | Kit workflows as product features | not started | | |
| 8 | Import, export, sync | not started | | |
| 9 | Easy everywhere (parity, menu, next step) | not started | | |
| 10 | Claim checker and PR receipts | not started | | |
| 11 | VS Code extension | not started | | |
| 12 | Measure, compare with the kit, document | not started | | |

## Phase plans

### Phase 0: audit (no product code)
- Exists: 46 kit practices (inventoried), 26 Codeceipt features, a partial performance doc on PR #55's branch.
- Gaps: no kit-to-Codeceipt map; no single baseline doc on main; no owner-actions list.
- PR: one docs-only PR adding this file, the saved plan, `docs/kit-migration.md`, `docs/performance.md`,
  `docs/owner-actions.md` and `docs/owner-pending/`.

### Phase 1: fast verification
- Exists: PR #55 contains PR #53 and the code of PR #51 (migrated test database image, parallel web test files,
  `// @slow` markers, docs). CI never ran on #53 or #55: their `.github/workflows/verify.yml` is invalid YAML (three
  unquoted step names containing ": "), so GitHub creates no check runs. Both branches also change the protected
  `scripts/verify.sh` and the human-owned workflow directly, and their `scripts/verify.sh` still runs dependents'
  tests in quick mode, against the owner's decision.
- Plan: a new branch from main with only the non-protected changes (test database image, Vitest workers tuned by
  measurement, `@slow` markers, AGENTS.md and build-checklist wording). The corrected `scripts/verify.sh` and a valid,
  zizmor-clean parallel `verify.yml` go to `docs/owner-pending/verify/` with an owner action. Close #51, #53 and #55
  with a pointer once merged.

### Phase 2a: footprint (server)
- Exists: 11 MCP tools, 10,247 chars in `tools/list` (≈ 2,560 tokens; `generate_receipt` 4,059 chars, mostly hook-only
  fields); start note ≤ 1,500 chars with the full feature list (≈ 600 chars); context pack built per request
  (4 round trips), no cache; no budget tests.
- Plan (one PR): advertise only agent-facing `generate_receipt` fields (hook-only fields still accepted and validated);
  short descriptions everywhere; `list_features` folds into `where_did_we_stop {features:true}` with the old name
  callable for one release but hidden from `tools/list`; start note lists features in progress and points to the
  full list; context-pack file/component block precomputed per feature after indexing (migration 0051, live
  fallback when missing); budget tests for tool definitions, start note size and read latency.

### Phase 2b: footprint (CLI)
- Done: code splitting (`dist/chunks/`), `@brain/core` `sideEffects: false` and `@brain/core/indexer` subpath, start
  note fetched in parallel with a 1.5 s cap and a saved fallback in `.git` (one project, ≤ 7 days, mode 0600), CLI 0.3.5.

### Phase 3a: Blueprint model (schema, core, service, MCP)
- Design: `docs/roadmap/phase3a-design.md`.
- Built: migration 0054 (optional; Blueprint calls answer `blueprint_not_ready` until it is applied), repos, core
  rules (EARS forms, ambiguity flags with rewrites, contradictions, must-never coverage, proof status, snapshots),
  owner service (edit in batches of ≤ 50 operations against a base version, accept/reject proposals, restore as a new
  version that retires and never deletes, history), agent side (`propose_blueprint`, `where_did_we_stop
  {blueprint:true}`), owner-approved CRITERIA and BOUNDARIES in context packs as data.
- Deferred to 3b: plan approval writing criteria, Discover, interview, 0054 becoming required. Web pages are 3c.

### Phase 3b: Discover, safety check, plan approval into the Blueprint
- Built:
  - **Plan approval** (the interview: `plan_project`, at most 8 questions with suggested answers) now writes the
    next Blueprint version in the same transaction. Each new checklist item becomes an active criterion linked to
    it; its kind comes from the item's plan kind; `depends_on` becomes dependencies.
  - **Proof**: a criterion whose checklist item is done shows "done, not proven".
  - **Discover** (`GET /api/projects/[id]/blueprint/discover`): an as-built view per feature (files, routes,
    components, related tests) with suggested must-never and sign-in criteria. The owner confirms one feature at a
    time through the normal edit route.
  - **Safety check** (`.../blueprint/safety`): at most 5 risks with "Fix with my agent" prompts, ranked secrets →
    open tables → unconfirmed RLS → weakened tests → features without a must-never.
  - **Owner routes** for view, edit, decide, restore and versions.
- Kept optional: migration 0054. Making it required would turn production health 503 until owner action 9 is done.
  It becomes required after the owner applies it.
- Not possible yet without a CLI change and a release: package.json dependencies and README/AGENTS.md are not
  indexed, so Discover does not show them. Logged in `agent/later.md` for a CLI release.

