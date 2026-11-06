# Roadmap progress

Source: [autonomous-plan.md](autonomous-plan.md). Re-read both files at the start of every session and continue from
the first item that is not merged or blocked. Never redo merged work. Owner actions: [../owner-actions.md](../owner-actions.md).

Status values: not started, in progress, merged, blocked (with reason).

| # | Phase / track | Status | PR | Result |
|---|---|---|---|---|
| 0 | Audit: kit migration map, baselines | in progress | [#57](https://github.com/jabez-abija2399/project-brain/pull/57) | Baselines: CI 27.5 min, local ≈ 21 min (web tests 14.6 min); ≈ 2,990 tokens at session start; hooks 0.3–0.6 s |
| 1 | Fast verification (supersedes PRs #51, #53, #55) | not started | | |
| 2a | Footprint: start note budget, compact MCP tools, cached context packs (server) | not started | | |
| 2b | Footprint: cached start note, fast hooks (CLI) | not started | | |
| 3a | Blueprint: versioned model, EARS criteria, proof status, flags | not started | | |
| 3b | Blueprint: Discover, interview, safety check | not started | | |
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
