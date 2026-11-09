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
| 3a | Blueprint: versioned model, EARS criteria, proof status, flags | merged | [#61](https://github.com/jabez-abija2399/project-brain/pull/61) | Migration 0054 optional (owner action 9); `propose_blueprint` MCP tool; tools/list 6,479 chars (budget 6,500) |
| 3b | Blueprint: Discover, interview, safety check | merged | [#62](https://github.com/jabez-abija2399/project-brain/pull/62) | |
| 3c | Blueprint: web views (Simple/Detailed), fixtures acceptance | merged | [#63](https://github.com/jabez-abija2399/project-brain/pull/63) | |
| 4 | Follow the Blueprint: start note, definition of done, prove it, done gate, receipts, review-first | 4a [#64](https://github.com/jabez-abija2399/project-brain/pull/64), 4b [#65](https://github.com/jabez-abija2399/project-brain/pull/65) merged; 4c in progress | | |
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

### Phase 3c: Blueprint pages
- Built:
  - **Blueprint tab:** the first visit asks "Do you usually read the code your AI writes?". The answer picks Simple
    or Detailed, is remembered in a display-only cookie, and can be switched any time.
    - **Simple:** per feature, rules and how many are proven, plus warnings.
    - **Detailed:** adds each rule in EARS form with its proof, kind and wording advice, dependencies, files and
      boundaries.
    - Agent proposals wait with Accept and Dismiss.
  - **Discover page:** the safety check with "Fix with my agent", and the next feature to confirm with "Add this
    rule".
  - **History page:** versions with Restore. Restore asks for confirmation.
  - Every action sends the version the page was loaded at, so a change made elsewhere meanwhile gets a clear
    message (409) and a too-large Blueprint gets 413.
- Acceptance (`blueprint-acceptance.test.ts`, @slow): the real CLI indexes `tests/fixtures/next-app` with the
  realistic Supabase migrations, and `tests/fixtures/vite-app`. Discover and the safety check show their routes,
  components and open tables.
- Checked at 375 and 1280 px with no sideways scrolling: `docs/screenshots/blueprint/`. This found and fixed a dated
  migration path that was masked as a secret.

### Phase 4a: the done gate
- **Gentle mode:** `codeceipt config stop-gate gentle|on|off` (`strict` means on). Gentle tells Claude Code what is
  missing through `additionalContext`, without a blocking error. Strict is still the default; owner action 10 asks
  the owner to decide.
- **Every agent with a Stop event is held back, each in its own format:** Claude Code, Cursor, Codex
  (`decision:block`) and Antigravity (`decision:continue`). The Codex and Antigravity plugins get a Stop hook.
  OpenCode stays "report only", because it has no documented way to continue.
- **Loop safety:** at most 2 continuations per session, counted locally and also checked against Cursor's
  `loop_count`. Without a session start (no state file) the gate never blocks.
- **No AI needed:** when the receipt cannot be made, the gate still holds the agent back for this session's open
  checklist items, removed or weakened tests, and new secrets. All of these come from local checks and the
  database.
- **CLI 0.3.6** replaces the unreleased 0.3.5 (owner action 8).
- **Next (4b):** start note and context pack from the Blueprint, definition of done per request, opt-in "prove it"
  runs, receipts checked against the Blueprint, and "Review here first".

### Phase 4b: following the Blueprint (server)
- **Review here first:** each receipt card now starts with at most three places to look at first, each with a
  plain reason. They come only from the receipt's own evidence, most serious first: secrets and open tables, then
  weakened tests, a failed check, missed, not done or partly done work, done but untested work, and changes outside
  the feature. Built by `packages/core/src/review-first.ts`.
- **Start note:** after the next feature, it lists that feature's owner-approved must-never and security criteria
  (at most 3). They are marked as data, and saved text cannot fake a heading. The note stays within its limit.
- **Context pack:**
  - Files are ranked: the feature's own files first, then files with components, then by path.
  - A new "TESTS THAT PROVE THESE CRITERIA" section lists linked test paths and names. Together with CRITERIA,
    BOUNDARIES and CHECKLIST (which includes past misses), the pack is the feature's definition of done.
- **Next (4c):**
  - A definition of done handed to the agent when a request is captured (prompt hook context; CLI change and
    release).
  - Opt-in "prove it" test runs.
  - Receipts checked against the Blueprint.

### Phase 4c: receipts checked against the Blueprint (server)
- **What every receipt is checked for:** the Blueprint's active boundaries.
  - Changed files under a protected path.
  - New packages the owner disallowed.
  - When the owner keeps an allowed list, new packages that are not on it.
- **Where it shows:** the receipt card's "Blueprint boundaries" section, ranked in "Review here first" right after
  security findings.
- **How it works:** the glob matcher (`packages/core/src/blueprint/boundary-check.ts`) never builds a regular
  expression from stored text, and its run time grows at most with pattern length times path length. Stored hits
  are masked per segment. Before migration 0054 receipts are unchanged, and the check never fails a receipt.
- **Moved to Phase 5's CLI release:** a definition of done handed to the agent when a request is captured, and
  opt-in "prove it" test runs. Blocking a protected path before the edit (PreToolUse) is Phase 5's main goal; this
  check catches what got through.

