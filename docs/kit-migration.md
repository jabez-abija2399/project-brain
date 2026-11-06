# From the AI Build Kit to Codeceipt

This repository is built with an AI Build Kit (v4.1.0, fast mode). Codeceipt is meant to replace it for users, and
eventually for this repository too. This page maps every kit practice to the Codeceipt feature that does (or will do)
the same job, so the owner can switch kit pieces off one at a time once Codeceipt has proven it covers them.

Status:
- **covered**: Codeceipt does this today, enforced by its server, hooks or CLI.
- **partial**: some of it exists; the gap says what is missing.
- **not built**: nothing yet; the phase column says where the roadmap
  ([roadmap/autonomous-plan.md](roadmap/autonomous-plan.md)) builds it.

Audited 2026-11-06 against main `61d0d79`. Phase 12 updates this page with measured results.

## Plan and criteria

| Kit practice | Kit enforcement | Codeceipt today | Status | Gap → phase |
|---|---|---|---|---|
| Feature registry (`agent/features.json`: status, priority, depends_on, files) | `kit.py check`; hand edits blocked | `features` (name, key, status, build_order), `feature_files`; `plan_drafts` with depends_on | partial | No versions or restore; depends_on lives only in drafts → 3a |
| Acceptance criteria with kinds (happy, attack, boundary, negative, state, permission, perf) | `check_features` (attack/permission required for security features; perf needs a number) | `requests` + `checklist_items` (free text) | partial | No kinds, no EARS form, no "at least one must-never/security per feature" → 3a |
| Pass records with evidence (test log must contain the criterion id) | `kit.py pass` | Receipts mark items done/partial/missed/unclear with file evidence; `done_untested`; check-run evidence (FEAT-022) | partial | No proof status per criterion linked to a passing test → 3a, 4 |
| Feature lifecycle (`start` needs dependencies done; `done` needs all criteria passing) | `kit.py start/done` | Feature status set by plans and receipts | partial | No dependency gate, no done-requires-proof → 3a, 4 |
| Never read the registry whole (`show`, `where`) | Instruction | `list_features`, `get_context_pack` (capped) | covered | Pack is built per request; precompute → 2a |
| Spec changes need human approval (`plan.json`, `SPEC_CHANGE_APPROVED`) | `check_immutable`, `import` | Owner approves plans on the web; agents only propose checklist changes (`propose_checklist_change`) | partial | No general approval policy or risk levels → 6 |
| Specs and threat models (`docs/specs/FEAT-*.md`) | Skills | Plan drafts | partial | No per-feature spec or threat-model fields; must-never criteria cover part → 3a |

## Session memory

| Kit practice | Kit enforcement | Codeceipt today | Status | Gap → phase |
|---|---|---|---|---|
| Session brief at start | SessionStart hook (`kit.py brief`) | Start note (`where_did_we_stop`, 1500 chars server, 4000 CLI cap) for 5 agents | covered | Over the ~500-token budget; no cached offline note → 2a, 2b |
| Progress handoff (`agent/progress.md`) | `stop-check` blocks stopping without it | `save_progress`; receipts at session end | covered | Receipts are the handoff; nothing to block on |
| Decision log (`docs/decisions.md`) | Instruction; dependency names read by guards | `decisions` table, `add_decision` | partial | Decisions not checked against new dependencies → 4 |
| User directives (`agent/directives.md`) | Brief injects them | `directives` (agent proposes, owner confirms) | covered | — |
| Known issues | Instruction; brief | Open/missed/postponed checklist items carried forward | partial | No severity or "fix HIGH first" ordering → 4 |
| Parking lot (`agent/later.md`) | Instruction | Postponed items | partial | No "ideas" bucket outside a request → 3a |
| One feature per session; report format | Instruction | Receipts (one per session); `codeceipt last` | partial | Plugin commands end with a report matching the receipt → 7 |

## Boundaries and protection

| Kit practice | Kit enforcement | Codeceipt today | Status | Gap → phase |
|---|---|---|---|---|
| Edit scope (`agent/scope.txt`) | Commit fails | Receipts list files outside the request's scope | partial | Reported after the fact, never blocked → 5 |
| Import boundaries (`docs/boundaries.txt`) | `check_boundaries` | None | not built | Blueprint boundaries + Guard → 3a, 5 |
| Protected files | `protect.py` PreToolUse blocks writes | None (no PreToolUse hook) | not built | Pre-tool-use blocking per agent → 5 |
| Human-only override variables | `protect.py` | Owner-only actions on the web; agents can't approve plans | partial | Policy engine; agents can never approve or change policy → 6 |
| Secrets unreadable (`.env`) | settings deny + hook | Secrets masked (first 4 chars + ***) before storing; secret findings in receipts | partial | Not blocked at read time → 5 |
| No `--no-verify`, hooksPath, force push | Hook | None | not built | Guard pre-tool-use rules → 5 |

## Test integrity

| Kit practice | Kit enforcement | Codeceipt today | Status | Gap → phase |
|---|---|---|---|---|
| No deleted tests | `check_diff` | `deleted_test_file`, `deleted_tests` in receipts; Stop gate blocks | covered | Not checked at commit or CI → 5 |
| No skipped or focused tests | `check_diff` | `skipped_tests` (incl. `.only`) in receipts; Stop gate | covered | Same → 5 |
| No weakened assertions | `check_diff` | `removed_assertions` | covered | Same → 5 |
| Test-runner config tampering | `check_diff` | `test_config_changed` | covered | Same → 5 |
| Snapshot changes need review | `check_diff` (warning) | None | not built | Guard warning → 5 |
| Passing-test ratchet | pre-commit | Passing-test count before/after in receipts (`test-integrity-local.ts`) | partial | Regression vs proven criteria → 4 |
| Criterion-named tests | `kit.py pass` greps the log | None | not built | Link tests to criteria → 3a, 4 |

## Gates

| Kit practice | Kit enforcement | Codeceipt today | Status | Gap → phase |
|---|---|---|---|---|
| `verify.sh` as the gate (stale or quick results never count) | `check --commit` | Build/test evidence (FEAT-022, `codeceipt config check`, `check-run`) | partial | "Prove it" related-test runs, done gate on proof → 4 |
| Stop gate (no ending with work unfinished) | `kit.py stop-check` | FEAT-020 Stop gate (Claude Code, Cursor), max 2 blocks, on/off | partial | gentle/strict/off modes, criteria-aware, boundary files → 4 |
| Security scanners (gitleaks, semgrep, osv) | verify.sh in CI | Secret scanner, RLS reviewer, `codeceipt rls` live check | partial | Guard secrets on changed files → 5 |
| Dependency check before adding (`dep-check`) | `protect.py` blocks unknown installs | `check_package` MCP tool; new dependencies in receipts | partial | Not blocking; no decision link → 4, 5 |
| 7-day dependency cooldown | `minimumReleaseAge` + `check_cooldown` | `check_package` reports age | partial | Policy rule "young package needs approval" → 6 |
| File size limit (300 lines, warning) | `check_sizes` | None | not built | Guard + maintainability flags → 5, 7 |
| Duplicate code (`dupes`) | `check_dupes` | `find_similar_component` (reuse before creating) | partial | No duplicate flag on new code → 7 |
| Pre-commit hook | `.githooks/pre-commit` | None | not built | `codeceipt guard --staged` (offered, never silent) → 5 |

## Reviews and workflows

| Kit practice | Kit enforcement | Codeceipt today | Status | Gap → phase |
|---|---|---|---|---|
| Fresh-context security pass | Skill; brief flags unreviewed features | None | not built | Second-opinion review → 7 |
| Independent peer review (`review-pack`, VERDICT) | `check` when `review_required` | None | not built | Second-opinion review recorded in the receipt → 7 |
| Evaluator (QA on the running app) | Strict mode role | None | not built | Out of scope for now; see later.md |
| `/feature`, `/bugfix`, `/change` workflows | Skills | Plugins for 5 agents (MCP + hooks) | partial | `/codeceipt-feature`, `-fix`, `-review` → 7 |
| Verify before claiming ("not checked = NOT VERIFIED") | Instruction + pass evidence | Receipts never mark unclear work done; "not verified" section | partial | Claim checker ("Claimed vs actual") → 10 |
| Build checklist (8 rules) | Instruction | None | not built | Rule packs → 7 |
| Fast/strict mode | `verify.config` | Stop gate on/off | partial | Presets (Careful, Balanced, Fast) → 6 |
| Multi-agent hook parity | `kit.py hooks` | Hooks for Claude Code, Cursor, Codex, OpenCode, Antigravity | covered | Pre-tool-use and stop where each agent supports them → 4, 5 |

## What to switch off first (after the listed phase is merged and measured)
Phase 12 fills this in with measured results. Order expected from the gaps above: session brief (2b), test integrity
at commit (5), boundaries and protected files (5), spec approvals (6), workflows (7).
