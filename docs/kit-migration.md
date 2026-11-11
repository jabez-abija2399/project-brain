# From the AI Build Kit to Codeceipt

This repository is built with an AI Build Kit (v4.1.0, fast mode). Codeceipt is meant to replace it for users, and
eventually for this repository too. This page maps every kit practice to the Codeceipt feature that does (or will do)
the same job, so the owner can switch kit pieces off one at a time once Codeceipt has proven it covers them.

Status:
- **covered**: Codeceipt does this today, enforced by its server, hooks or CLI.
- **partial**: some of it exists; the gap says what is missing.
- **not built**: nothing yet; the phase column says where the roadmap
  ([roadmap/autonomous-plan.md](roadmap/autonomous-plan.md)) builds it.

Audited 2026-11-06 against main `61d0d79`. Updated 2026-11-11 after the roadmap: see
[After the roadmap](#after-the-roadmap-phase-12-2026-11-11) near the end.

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

## After the roadmap (Phase 12, 2026-11-11)

The tables above are the audit from before the roadmap and are kept as they were. This section says where each
area stands now that Phases 0-11 are merged. "Merged" means the code is on main with tests; most of it reaches users
only after the owner actions in [owner-actions.md](owner-actions.md) (above all action 8, the CLI release, and the
optional migrations 0054-0056).

| Kit area | Now in Codeceipt | Status now | Still only in the kit |
|---|---|---|---|
| Feature registry, criteria with kinds, pass records | Project Blueprint: versions with restore, criteria in plain text and EARS form with a kind and a proof status, at least one must-never per feature, flags for vague or contradicting criteria (Phase 3) | covered | Criterion ids in test names (`kit.py pass` greps the log); Codeceipt links tests to criteria by file |
| Feature lifecycle (start needs dependencies, done needs proof) | Dependencies and build order in the Blueprint; the done gate holds an agent back while criteria are open (Phase 4a); receipts show progress per feature and newly proven criteria (4c) | partial | A hard "cannot start before its dependencies are done" stop |
| Spec changes need human approval | Agents only propose; the owner approves on the web. Approval policies with risk levels, presets, pause, undo and an append-only audit log; agents can never approve (Phase 6) | covered | — |
| Session brief | Start note within a tested budget, saved copy when the server is slow (Phase 2) | covered | — |
| Progress handoff, decisions, directives, known issues, parking lot | `save_progress`, receipts, decisions, directives, open and postponed items carried into the start note; one next step everywhere (Phase 9) | covered | Severity on known issues ("fix HIGH first") |
| Edit scope (the kit's scope file) | The definition of done names the request's feature files (5c); receipts list files outside it | partial | Blocking a commit that touches a file outside the scope |
| Import boundaries, protected files | Blueprint boundaries and protected paths; edits under a protected path are stopped before they happen in Claude Code, Cursor, Codex and Antigravity (5b); `codeceipt guard` checks them at commit and in CI (5a) | covered | Import-direction rules between packages are checked only as path rules |
| Human-only override variables | Owner-only actions; policy changes are owner-only and audited (Phase 6) | covered | — |
| Secrets unreadable (`.env`) | New secrets are found and masked at commit, in CI and in receipts (5a) | partial | Blocking the read of `.env` files |
| No `--no-verify`, hooksPath, force push | Not built | not built | All of it |
| Test integrity (deleted, skipped, weakened, config) | The same checks at session end, at commit (`guard --staged`) and in CI (`guard --ci`) (5a) | covered | Snapshot-change warning; the passing-test ratchet as a hard stop |
| The gate (`verify.sh`) | Build and test evidence on receipts; opt-in `codeceipt prove` runs the tests linked to a request (5d); the claim checker compares "tests pass" with a fresh local report (10a) | partial | One command that runs typecheck, lint, tests and scanners and whose stale results never count |
| Stop gate | Gentle, strict and off modes; works without the AI receipt; Codex and Antigravity included (4a) | covered | — |
| Security scanners | Secret scan and hidden-character scan in Guard; RLS reviewer | partial | semgrep and osv-scanner (run them in CI as today) |
| Dependency check and cooldown | `check_package`; Guard flags packages the owner disallowed; adding a dependency is a policy action (Phases 5, 6) | partial | Blocking an install before it happens; the 7-day cooldown |
| File size limit, duplicates | `codeceipt review` flags files over 300 lines and large changes (7a); `find_similar_component` | partial | A duplicate-code flag on new code |
| Pre-commit hook | `codeceipt guard --staged`, offered at setup, never installed silently (5a) | covered | — |
| Fresh-context security pass, peer review, evaluator | `/codeceipt-review` and `codeceipt review` print the eight build-checklist rules a change touches (7a) | partial | A second agent's independent verdict; QA on the running app |
| `/feature`, `/bugfix`, `/change` workflows | `/codeceipt-feature`, `/codeceipt-fix`, `/codeceipt-review` in the plugins (7a) | covered | `/kickoff`, `/perf`, `/audit`, `/state` |
| Verify before claiming | Claim checker: what the agent said, checked on the user's machine (10a) | covered | — |
| Fast/strict mode | Presets Careful, Balanced, Fast (Phase 6); stop gate and guard modes | covered | — |
| Multi-agent hook parity | Start, prompt, pre-tool-use and stop hooks where each agent supports them (research in `roadmap/research-agent-hooks.md`) | covered | — |

New in Codeceipt, with no kit equivalent: Discover (a Blueprint from an existing codebase), import from and export to
other spec formats (Phase 8), receipts on pull requests (10b), the web pages, and the VS Code extension (Phase 11).

## What to switch off first
Nothing should be switched off in this repository yet: the pieces below are merged but **unreleased** (owner action
8) and several need a migration applied (actions 9, 11, 13). After those, in this order, one at a time, watching a
few sessions between each:

1. **Session brief**: use the Codeceipt start note. Lowest risk: it only informs.
2. **Test-integrity checks at commit**: `codeceipt guard --staged` as the pre-commit hook, and `guard --ci` in CI
   (a workflow change: owner-owned).
3. **Protected files**: the Blueprint's protected paths with the pre-tool-use hook in strict mode.
4. **Spec-change approval**: approval policies (preset Careful to start).
5. **Workflows**: `/codeceipt-feature`, `-fix`, `-review`.

Keep in the kit for now, because Codeceipt has no equivalent (see the last column above): `verify.sh` as the single
gate, the edit scope as a commit stop, the dependency install block and cooldown, the `.env` read block, the
`--no-verify` and force-push block, semgrep and osv-scanner, and the independent peer review.

For another project that uses a build kit, see [switching-from-a-build-kit.md](switching-from-a-build-kit.md).
