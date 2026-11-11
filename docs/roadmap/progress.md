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
| 4 | Follow the Blueprint: start note, definition of done, prove it, done gate, receipts, review-first | merged | 4a [#64](https://github.com/jabez-abija2399/project-brain/pull/64), 4b [#65](https://github.com/jabez-abija2399/project-brain/pull/65), 4c [#66](https://github.com/jabez-abija2399/project-brain/pull/66) | Definition of done and "prove it" runs moved to Phase 5b (CLI) |
| 5 | Guard: pre-tool-use boundaries, `codeceipt guard --staged/--ci` | merged | 5a [#67](https://github.com/jabez-abija2399/project-brain/pull/67), 5b [#68](https://github.com/jabez-abija2399/project-brain/pull/68), 5c [#69](https://github.com/jabez-abija2399/project-brain/pull/69), 5d [#70](https://github.com/jabez-abija2399/project-brain/pull/70) | CLI 0.3.7 (owner action 8) |
| 6 | Approval policies | merged (email notifications wait on owner action 12) | 6a [#71](https://github.com/jabez-abija2399/project-brain/pull/71), 6b [#72](https://github.com/jabez-abija2399/project-brain/pull/72) | Migration 0055 optional (owner action 11); email needs owner action 12 |
| 7 | Kit workflows as product features | merged (receipt flags later) | 7a [#73](https://github.com/jabez-abija2399/project-brain/pull/73) | `/codeceipt-feature`, `-fix`, `-review`; `codeceipt review` |
| 8 | Import, export, sync | merged (automatic sync suggestions later) | 8a [#74](https://github.com/jabez-abija2399/project-brain/pull/74), 8b [#75](https://github.com/jabez-abija2399/project-brain/pull/75) | `codeceipt import` into a plan draft; `codeceipt export` with `--check` |
| 9 | Easy everywhere (parity, menu, next step) | merged | 9a [#76](https://github.com/jabez-abija2399/project-brain/pull/76), 9b [#77](https://github.com/jabez-abija2399/project-brain/pull/77) | One next step (Overview + `codeceipt status`); `docs/actions.md`; keyboard menu; "How do you build?" |
| 10 | Claim checker and PR receipts | merged (posting waits on owner actions 13 and 14) | 10a [#78](https://github.com/jabez-abija2399/project-brain/pull/78), 10b [#79](https://github.com/jabez-abija2399/project-brain/pull/79) | Receipts check what the agent said against the change; one receipt comment per pull request, off by default |
| 11 | VS Code extension | merged (publishing is owner action 15) | [#80](https://github.com/jabez-abija2399/project-brain/pull/80) | Status bar and side bar from `codeceipt status --json` / `last --json`; publishing is owner action 15 |
| 12 | Measure, compare with the kit, document | merged | [#81](https://github.com/jabez-abija2399/project-brain/pull/81) | 1,996 tests; local gate ≈ 11 min 40 s, CI 13.5 min; every hook within budget; final docs |

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


### Phase 5a: Codeceipt Guard (`codeceipt guard`)
- **What it checks**, only in the changed files and only on the user's machine:
  - tests deleted, removed, newly skipped or focused, or with fewer assertions, and changed test settings (the
    existing FEAT-018 check);
  - secrets added by the change (the existing FEAT-015 scanner, new lines only);
  - hidden or lookalike characters on added lines: bidi controls, zero-width marks, tag characters, and letters
    from another alphabet inside a Latin word (`packages/core/src/hidden-chars.ts`);
  - the Blueprint's protected paths and package rules (the 4c matcher);
  - files over 1 MB.
- **Each problem** names the file, the line when there is one, what is wrong and the exact fix. Secrets, source
  lines and raw characters are never printed.
- **Where it runs:** `--staged` (the pre-commit hook), `--ci [--base <branch>]` (the branch against its base) or,
  with no flag, the uncommitted changes. `--json` gives machine-readable output.
- **Modes:** strict (problems fail the command, the default), gentle (problems are only reported) and off. Set with
  `--mode` or `codeceipt config guard`.
- **Pre-commit hook:** setup asks whether to add it; it is never installed without a yes.
  `codeceipt guard --install-hook` adds it later. An existing hook is never changed; the line to add is printed
  instead.
- **Boundaries:** read from a new token route, `GET /api/hooks/:projectId/boundaries` (active boundaries only;
  "not ready" before migration 0054), and cached in `.git/codeceipt/` so the guard still checks them offline.
- **Speed:** 100 changed files in under 2 s (test PH5-17).
- **Release:** CLI 0.3.7 (owner action 8, which replaces the unreleased 0.3.6).
- **Next (5b):**
  - pre-tool-use blocking of protected paths per agent (Claude Code, Cursor, Codex, Antigravity; OpenCode is
    report-only), from the same cached boundaries;
  - a definition of done when a request is captured;
  - opt-in "prove it" runs.

### Phase 5b: protected paths blocked before the edit (pre-tool-use hooks)
- **New hook:** `codeceipt hook pre-tool --agent <agent>` runs before an agent writes a file.
  - It reads the target files from the hook input: `file_path` / `notebook_path`, Cursor's `target_file`,
    Antigravity's `TargetFile`, and every file in a Codex `apply_patch`.
  - It resolves `..`, then checks each file against the Blueprint's protected paths kept in `.git/codeceipt/`.
  - No server call and no AI: it answers in under 200 ms (PH5B-10).
- **Where it blocks** (strict, the default):

  | Agent | Hook | Strict | Gentle |
  |---|---|---|---|
  | Claude Code | `PreToolUse`, matcher `Edit\|Write\|MultiEdit\|NotebookEdit` | `permissionDecision: "deny"` | `"ask"` (the person decides) |
  | Cursor | `preToolUse` | `permission: "deny"` | allowed, with a note to the agent |
  | Codex | `PreToolUse`, matcher `apply_patch` | `permissionDecision: "deny"` | nothing (Codex cannot ask) |
  | Antigravity (plugin) | `PreToolUse` | `decision: "deny"` | `"ask"` |
  | OpenCode | none | report only (no documented way to block) | |

- **Where blocking is not possible:**
  - Shell commands are not parsed, since a command can write anywhere. `codeceipt guard` catches them at commit
    time.
  - A hook that times out or fails lets the tool run (each agent's own rule).
  - Antigravity set up per repo (not by plugin) has only the session start hook, as before.
- **Not covered:**
  - Edits through other tools (MCP file tools, a shell-wrapped patch) are not checked.
  - A write into another linked repo is checked against this repo's rules only.
- **Security review (fresh context): all findings fixed, each with an attack test (PH5B-11..15).**
  - **Large edits:** the hook reads up to 8 MB; a larger edit is refused, never let through unread.
  - **Real paths:** targets and the root are resolved through symlinks, `~` is expanded, and letter case is ignored on
    macOS and Windows. Windows' trailing dots and spaces are dropped.
  - **Never cut silently:** more than 500 files in one call is refused, long paths count as hits, and indented patch
    headers are read.
  - **Codeceipt's own files:** `.git/` and Codeceipt's settings file are never written by an agent's file tool, so the
    check cannot be switched off that way.
  - **Smaller fixes:** Cursor gentle mode leaves Cursor's own approval in place, and the boundary refresh is bounded
    as a whole.
- **Modes:** the same setting as the guard (`codeceipt config guard strict|gentle|off`).
- **Boundaries on disk:** session start refreshes them alongside the start note, within the same wait limit. A server
  before migration 0054 leaves the kept copy as is. The answer is read up to 256 KB only.
- **Registration:** `codeceipt init` writes the hook for Claude Code, Codex and Cursor; the four plugins carry it
  too. `codeceipt init --remove-repo-files` removes it like the others.
- **Moved to 5c:** a definition of done when a request is captured, and opt-in "prove it" runs.

### Phase 5c: a definition of done when a request is captured (D-030)
- **What the agent gets:** when the user sends a request, Claude Code's and Codex's prompt hooks add the request's
  definition of done to the agent's context, as `additionalContext`.
- **How the note is built:**
  - The server matches the request to a feature by the words of the feature's name. There is no AI, and a tie or no
    match gives no note.
  - The note lists the feature's owner-approved criteria (done when / must never), the protected paths and the
    linked tests, at most 1,500 characters.
- **Route:** `POST /api/hooks/:projectId/definition-of-done` (project token, its own rate limit). It answers empty
  before migration 0054.
- **Limits:**
  - The hook waits at most 1.5 s (the start note's limit) and reads at most 16 KB.
  - Server text is cleaned line by line, as the start note is.
  - Any failure means no note, and the prompt is never held up longer or blocked.
  - Recording the request still runs in the background, unchanged.
- **Not covered:** Cursor (its prompt hook cannot add context) and the other agents.
- **Security review (fresh context): all 6 findings fixed, with attack tests (PH5C-11, PH5C-12).**
  - **Moderate:** the whole lookup (git included) is bounded by the 1.5 s limit.
  - **Minor:**
    - A one-word feature name needs the exact word, at least 4 letters long.
    - A name's quotes cannot close the note's header.
    - The request body is read up to 32 KB.
    - Up to 1,000 features and all active boundaries are read.
    - The CLI also strips zero-width and tag characters, and names match in NFC.
- **Moved to 5d:** opt-in "prove it" runs.

### Phase 5d: opt-in "prove it" runs (`codeceipt prove`)
- **What runs:** `codeceipt prove [--for "<request>"] [--json]` runs only the tests for the current change:
  - changed test files;
  - the test files next to changed source files (`a.ts` → `a.test.ts` / `a.spec.ts`);
  - with `--for`, the tests the owner linked to the request's feature (from the 5c route, which now also returns test
    paths).
- **How:**
  - It uses the repo's own check command (`codeceipt config check`) with its time limit.
  - It works only with commands that take file names: vitest, jest, or npm/pnpm/yarn test. Any other command gets a
    plain message and nothing runs.
- **Opt-in:** it runs only when someone runs it. Nothing is uploaded: counts and failing test names are printed here
  only.
- **Safety:**
  - Test paths are plain characters only and quoted; a path starting with `-` or containing `..` never runs.
  - At most 100 files, and the check command's process-tree kill on timeout.
- **Security review (fresh context): no HIGH findings; all others fixed (attack test PH5D-06).**
  - **MEDIUM:** a single very long output line slowed the failing-name parse after the run. Lines are now cut to 500
    characters first.
  - **LOW:**
    - Server paths like "/", "." or a folder would run every test; only real test files inside the repo run now.
    - The command check refuses shell metacharacters.
    - Colour codes no longer hide failing test names.
    - Paths go unquoted on Windows (plain characters only).
  - **Not verified:** how `cmd.exe` receives the check command on Windows predates this change and needs a Windows
    machine.

### Phase 6a: approval policies (engine, storage, server)
- **Engine** (`packages/core/src/approvals.ts`, `docs/approvals.md`):
  - every action has a risk level (low, medium, high, locked);
  - the choices are never, ask, auto and tell me, and auto;
  - rules are scoped by action, feature, path pattern and agent, and checked never first, then ask, then the
    automatic choices;
  - presets: Careful, Balanced (the default) and Fast;
  - locked actions are always asked, whatever a rule says;
  - a pause makes nothing automatic;
  - a loosening check.
- **Storage:** migration 0055 (optional; owner action 11) adds `approval_policies`, `approval_requests` (24-hour
  expiry) and `approval_audit` (append-only, enforced by a trigger).
- **Server** (`apps/web/src/server/approvals.ts`):
  - **Owner only** (session auth plus project access in every function):
    - see the policy, pending requests and automatic approvals;
    - change the policy (loosening needs `confirm: true`);
    - approve or reject, with an optional "remember" that becomes a rule;
    - undo an automatic approval once;
    - pause for 1, 2 or 4 hours.
  - **Agents** (a project token) can only ask (`POST /api/hooks/:projectId/approvals`) and read a request's status.
    An agent token on the owner routes gets 401.
  - Every change and decision goes into the audit log.
- **Next (6b):**
  - the web page (Simple shows the presets, Detailed the table and rules);
  - `codeceipt approve` / `pause`;
  - the pre-tool hook's "ask" becoming an approval request;
  - undo wired to each action;
  - the daily summary and notifications.
- **Security review (fresh context): all findings fixed, with attack tests (PH6-18..20 and TRUNCATE in PH6-08).**
  - **HIGH 1:** restrictive rules now also apply when the agent leaves a field out; paths are normalised before
    matching; the answer never names the rule.
  - **HIGH 2:** removing, changing or reordering rules counts as loosening, so it needs confirmation.
  - **MEDIUM:**
    - A remembered rule keeps the request's path and needs confirmation for high-risk or unscoped automatic rules.
    - A full policy refuses new remembered rules (no silent trim).
    - Policy changes and new requests run under one per-project lock.
  - **LOW:**
    - An unreadable stored policy asks for everything.
    - TRUNCATE of the audit log is refused.
    - The open-request limit is checked under the lock, and finished requests are pruned after 30 days.
    - Before 0055 the answer is `approved: false`.

### Phase 6b: the Approvals tab
- **New tab:** Approvals (`/projects/:id/approvals`, owner only).
- **Simple view:**
  - what is waiting (approve, reject, "always approve/reject this kind", with a confirm when the server asks);
  - the three presets, with the current one marked;
  - pause for 1, 2 or 4 hours, or end the pause;
  - what ran on its own lately, with undo.
- **Detailed view:** adds every action by preset and the policy's rules.
- **Phones:** wide tables scroll inside their card.
- **CLI:** `codeceipt approvals` prints the tab's link; the CLI never decides (it has only a project token).
- **Not built, waiting on owner action 12:** email and browser notifications, which need an email provider and its
  secret.
- **Later:**
  - The pre-tool hook's "ask" becoming an approval request. The hook stays offline by design: 5b's "no server call
    per edit".
  - Undo wired to each action's own revert.
- **Security review (fresh context): no HIGH findings; all others fixed (attack tests PH6B-06, PH6B-07).**
  - **MEDIUM:**
    - An agent's glob path (`**`) is never copied into a remembered rule.
    - An unscoped remembered approval needs confirmation, and the message names the rule's scope.
  - **LOW:**
    - Preset buttons send only the preset; the server keeps the stored rules and pause.
    - The "always" buttons have their own screen-reader labels.
    - An agent's summary is set apart as "Agent says".

### Phase 7a: workflows, review checklist, maintainability flags
- **Plugin skills:** `/codeceipt-feature`, `/codeceipt-fix` and `/codeceipt-review` in all four plugins (Claude Code,
  Cursor, Codex, Antigravity), from one source (`packages/agent-plugins/src/workflows.ts`).
  - Each is a short list of steps using the existing MCP tools and the local `codeceipt guard`, `prove` and `review`.
  - Tool answers are project data, never orders; the skills only ever forbid weakening tests.
  - `/codeceipt-review` asks for a second opinion from a fresh-context helper agent when the agent can start one,
    given only the diff and the checklist.
- **Rule pack:** `packages/core/src/review-checklist.ts` turns the eight rules of `docs/build-checklist.md` into
  checks chosen from changed paths and added lines only (no AI). A test keeps the titles in step with the document.
- **Maintainability flags:** a file this change made longer than 300 lines, more than 400 new lines, more than 20 files.
- **CLI:** `codeceipt review [--staged | --ci [--base <branch>]] [--json]` prints both. It runs on this machine, sends
  nothing and never blocks. Part of the unreleased CLI 0.3.7 (owner action 8).
- **Later:** maintainability flags on the receipt itself (needs a receipt field on the server).
- **Security review (fresh context): no HIGH findings; all others fixed or recorded.**
  - **MEDIUM:**
    - The skills run only the installed app: `command -v codeceipt` must be an absolute path outside the repo, never
      npx or a repo script (a hostile repo could ship its own `codeceipt`).
    - Review paths are shown the way Guard shows them: invisible characters removed, secrets masked, 300 characters
      at most (PH7-17).
  - **LOW:**
    - The skills say outright: never change Guard or `codeceipt config`, never approve, never send code.
    - Holding the whole changed-file list in memory is the same as in Guard; recorded in `agent/later.md`.

### Phase 8a: importers
- **Command:** `codeceipt import [--from kit|speckit|kiro|openspec|agents|readme] [--dry-run]` reads an existing spec on
  this machine. Sources:
  - the AI Build Kit's `agent/features.json`;
  - Spec Kit `specs/*/spec.md`;
  - Kiro `.kiro/specs/*/requirements.md`;
  - OpenSpec `openspec/specs/*/spec.md`;
  - the rules in `AGENTS.md` / `CLAUDE.md`;
  - a README's feature list.
- **What is sent:** feature names, short criterion texts (240 characters) and file:line. The server cleans it again
  and saves it as the project's plan draft.
- **Approval:** nothing is active until the owner approves it on the Plan tab (approve_import is high risk; a token
  cannot approve).
  - Each approved criterion keeps `[from path:line]`.
  - Features the project already has are skipped.
  - A draft holds 20 features with 8 criteria each; run the import again for the rest.
- **Readers:** deterministic, no AI (`packages/core/src/import/`). Tested on this repo's own `agent/features.json`
  and `AGENTS.md`, plus fixtures for Spec Kit, Kiro, OpenSpec and README.
- **Next (8b):** exports (managed AGENTS.md section, OpenSpec, Spec Kit), and sync suggestions after index/push.
- **Security review (fresh context): no HIGH findings; all others fixed, with attack tests (PH8-17, PH8-18).**
  - **MEDIUM:**
    - An import no longer silently replaces a `plan_project` plan the owner has not decided on: 409 `plan_pending`
      unless `--replace` is used. The draft records the token that imported it.
    - The rules check no longer backtracks over long lines. Lines over 2,000 characters are skipped by every reader.
  - **LOW:**
    - The kit reader reads at most 50 checks per feature and finds lines in one pass.
    - The CLI reads at most 200 files of 256 KB.
    - Server counts are printed as numbers only.

### Phase 8b: exports and the sync check
- **Command:** `codeceipt export --to agents|openspec|speckit [--write | --check]` writes the owner-approved Blueprint
  into the repo. The targets:
  - a managed section of `AGENTS.md`; everything outside its markers is kept;
  - OpenSpec `openspec/specs/<slug>/spec.md`;
  - Spec Kit `specs/<nnn>-<slug>/spec.md`.
- **Modes:**
  - Without `--write` it says what would change.
  - `--check` fails when the files are out of date. This is the sync check for CI or a pre-commit hook.
- **Safety:** it only rewrites files it wrote (marked "generated by codeceipt export"), keeps hand-written ones, and
  never writes through a symlink or outside the repo.
  - Broken markers in `AGENTS.md` leave the file alone.
  - Text is escaped, so a criterion can never add a heading, a list, HTML, a link or a marker.
- **Server:** `GET /api/hooks/:projectId/blueprint` (project token) returns active criteria and boundaries only (never
  proposals), cleaned and capped. Nothing is returned before migration 0054.
- **Round trip:** Spec Kit and OpenSpec files written by export are read back by `codeceipt import`.
- **Not built:** automatic sync suggestions after index/push through the approval policy. `--check` covers the
  "out of date" signal for now; recorded in `agent/later.md`.
- **Security review (fresh context): no HIGH findings; all others fixed, with attack tests (PH8-32..34).**
  - **MEDIUM:**
    - A boundary pattern can no longer write a section marker: inline code is escaped too, and markers count only
      as whole lines.
    - Merging no longer takes quadratic time on long whitespace (`trimEnd`).
  - **LOW:**
    - Size limits:
      - The export has a total text budget (400 KB on the server and in the renderer).
      - An AGENTS.md over 1 MB gets its own message.
    - File safety:
      - Hard-linked files are refused.
      - The file opened is checked against the one inspected (inode and device), and checked again right before
        opening where no-follow is missing (Windows).
    - Generated specs left over from an earlier export are named as stale, never deleted.
    - Windows device names get a suffix.
    - Headings are cut before they are escaped.
    - Empty criteria are skipped, and a leading `*` or `_` is escaped.

### Phase 9a: one next step, every action in one place
- **One next step:** a core `nextStep` picks the single most useful thing to do from a few counts, in order of
  urgency:
  1. agents waiting on approvals;
  2. a plan draft;
  3. no receipt yet;
  4. missed items;
  5. features without criteria;
  6. all clear.
- **Where it shows:**
  - The Overview page shows it in a "Next step" card, with its page, its command and what to ask the agent.
  - `codeceipt status` prints the same step.
- **`codeceipt status`:** the server sends counts only (`GET /api/hooks/:projectId/next-step`, project token). The CLI
  words the step itself, so no server text reaches the terminal.
- **`docs/actions.md`:** every action in one table (terminal, web, ask your agent). Parity tests fail when a CLI
  command, an MCP tool or a project tab is missing from it.
- **Cross-links:**
  - CLI to web: `status`, `approvals` and `import` print the page.
  - Web to CLI and agent: the Overview names the command and the agent ask.
- **Next (9b):** the keyboard menu and the sign-up "How do you build?" question.
- **Security review (fresh context): no HIGH or MEDIUM findings.**
  - **LOW, fixed:** the next step reads counts only, never rows: active criteria, pending unexpired approvals and
    features, each with one SQL count.

### Phase 9b: the keyboard menu and "How do you build?"
- **The menu:** `codeceipt` with no arguments, in a connected repo and a terminal someone can answer, shows a numbered
  menu. The entries are status, last, review, guard, prove, doctor, and connect again; each one runs that ordinary
  command.
  - Enter quits.
  - Without a terminal, or in a repo that is not connected, the setup runs as before.
- **"How do you build?"** on the Get started page: Claude Code, Cursor, Codex, another agent, or an existing spec.
  - Each answer shows its three first steps (fixed text in `packages/core/src/build-guide.ts`).
  - The answer is a plain link (it works without JavaScript) and is remembered in a cookie. It is a display
    preference only.
- **Not stored on the server:** the answer lives in the browser cookie, so no migration is needed. Recording it per
  account would need a migration and is in `agent/later.md`.
- **Security review (fresh context): no HIGH or MEDIUM findings.**
  - **LOW, fixed:**
    - A bad `?build=` no longer hides a remembered answer.
    - The cookie is Secure on HTTPS.
    - The choices are a `nav` labelled by the heading, so screen readers hear the question once.
  - **LOW, kept as is, with reasons:**
    - An agent in a real terminal can see the menu. Every entry is a fixed command the agent can already run, and
      hooks never take this path.
    - Checking the link may write the repo fingerprint for an old link. It is inside `.git`, and this is the same
      behaviour as every linked command.
- **CI fix:** the first CI run failed the production build. The new client component imported the `@brain/core`
  barrel, which pulls `node:path` into the browser bundle; the local gate runs the build in CI only. Now the page
  passes the choices in as props.
  - A new test (PH9-20) fails if any client component imports `@brain/core` or `@brain/db`.
  - `next build` passes locally.

### Phase 10a: the claim checker
- **What it does:** when an agent stops, Codeceipt reads its final message on the user's machine and checks what it
  says against the session's changes. Four kinds of claim:
  - "added tests": confirmed when a test file with code was added or changed and still exists;
  - "tests pass": confirmed only by a test report written during this session with no failed tests; contradicted
    when tests fail, fewer pass than before, or tests were skipped or weakened; otherwise "cannot check";
  - "changed <file>": confirmed when that file changed;
  - "did not touch <file or folder>": contradicted when it changed.
- **Privacy:** the message's words never leave the machine. A claim on the receipt is only its kind, a repo path
  when it names one, and the verdict. The server refuses free text, unknown kinds and paths outside the repo.
- **Where it shows:** a "What the agent said, checked" section on the receipt, contradicted claims first.
- **Agents:** Claude Code and Codex send the final message to Stop hooks (`last_assistant_message`). Cursor and
  Antigravity do not, so their receipts have no claims section.
- **No AI call:** deterministic patterns only (`packages/core/src/claims.ts`). Vague claims ("done", "fixed the
  bug") are not claims here; a single optional AI call for them is in `agent/later.md`.
- **Part of the unreleased CLI 0.3.7** (owner action 8).
- **Security review (fresh context): two HIGH and four MEDIUM findings, all fixed, with attack tests (PH10-04..07,
  PH10-08, PH10-12).**
  - **HIGH 1:** a "path" read from the message could be any words with a slash or a dot (a key, an email, a date).
    Now a claim's path is only ever a real file or folder of this repo, looked up in git; anything else is dropped.
  - **HIGH 2:** "tests pass" was confirmed by any report with passing tests. Now it needs a report written during
    the session with zero failed tests.
  - **MEDIUM:**
    - When the session's changes are unknown (no git, no start snapshot), every verdict is "cannot check".
    - A sentence that mixes changed and untouched files claims neither; "left a TODO in X" is not "left untouched".
    - "Added tests" needs a test file with code that still exists (not a fixture or a deleted test).
    - A bare file name shared by several files names none of them.
  - **LOW:**
    - The section is titled "checked on your machine" (a project token could send its own verdicts, as with the
      test checks).
    - Recorded in `agent/later.md`: a final message over 64 KB makes the whole hook input be ignored (this predates
      the change).

### Phase 10b: receipts on pull requests
- **What it does:** for a pull request of a repository connected through the GitHub App, the project's receipts for
  the pull request's commits become one comment, updated in place on each push, plus a check run that never blocks a
  merge (neutral when something needs a look, success when nothing does).
- **Off by default:** the owner turns it on per project on the Connect tab. The switch is stored in a new table
  (migration 0056, optional; owner action 13).
- **Needs the owner:** the GitHub App must get the Pull requests and Checks permissions and the Pull request event
  (owner action 14). Until then nothing is posted; a missing permission ends the job quietly.
- **Safety:**
  - never for a fork's pull request;
  - a public repository (or one whose visibility is unknown) gets counts only, no item text or file names;
  - the webhook signature is checked first, and the posting runs as an Inngest job;
  - the job re-checks the link and the switch, and posts at most 200 comments a day per project;
  - only the App's own earlier comment is updated; item text is escaped.
- **No file is read:** only the pull request's commit ids are listed; receipts are matched by commit.
- **Security review (fresh context): no HIGH findings; both MEDIUM findings fixed, with attack tests (PH10B-12,
  PH10B-13, PH10B-17).**
  - **MEDIUM:**
    - Two projects linked to one repository could overwrite each other's comment. The marker now names the project,
      and only this App's own comment is updated.
    - Item text could carry `@mentions`, `#123` and bare links. It is now shown in a code span, so it stays plain
      text.
  - **LOW, fixed:**
    - Up to 500 comments are searched for the earlier comment.
    - The job reads the repository's visibility again: only "private" gets item text (public, internal or unknown
      get counts only).
    - A suspended project posts nothing.
    - A database or queue error in the webhook forgets the delivery, so GitHub's redelivery is processed.
  - **Recorded in `agent/later.md`, not fixed here:**
    - No debounce of repeated pushes to one pull request (the daily cap of 200 bounds it).
    - The repository picker when linking through the GitHub App lists every repository of the installation, not only
      the ones the signed-in user can read. This predates Phase 10b and is an auth change outside this feature, so it
      needs the owner's go-ahead.

### Phase 11: Codeceipt in VS Code
- **CLI:** `codeceipt status --json` and `codeceipt last --json` print the same answers as one line of data (no
  token, no server text, control characters removed). CLI stays 0.3.7, unreleased (owner action 8).
- **Extension (`packages/vscode-extension`, not published):** a status bar item, a "Codeceipt" section in the
  Explorer and four commands. See [../vscode-extension.md](../vscode-extension.md) and decision D-031.
- **Safety:**
  - runs only the installed `codeceipt`, by absolute path, never one inside the opened folder (or linked into it);
  - two fixed argument lists, no shell, 15 s and 256 KB limits;
  - no token, no network code, no web view, nothing written;
  - nothing in an untrusted workspace;
  - links open only when https (http for localhost); receipt text is plain, one line, capped.
- **One new dev dependency:** `@types/vscode` 1.90.0 (types only; row in `docs/dependencies.md`).
- **Not verified:** the editor glue (`src/extension.ts`) is type-checked and bundled but not run in a real editor
  here; trying it, packaging and publishing are owner action 15.
- **Security review (fresh context): one HIGH and one MEDIUM finding, both fixed, with attack tests.**
  - **HIGH (Windows; MEDIUM elsewhere), fixed (PH11-18, PH11-23):** the CLI started `git` by its bare name. On
    Windows a bare name is looked up in the current folder first, so a project that ships a `git.exe` would have had
    it run when the editor opened the folder. The CLI now starts git by its full path, found in absolute PATH
    folders only (this protects every command and hook, not only the extension), and the extension gives the
    command a PATH with no project folder in it.
  - **MEDIUM, fixed (PH11-17):** with a subfolder of a repository opened, a `codeceipt` elsewhere in that repository
    (for example `node_modules/.bin` on PATH) was accepted. The whole repository is now off limits.
  - **LOW, fixed:**
    - Windows PATH folders without a drive letter are skipped (PH11-19).
    - `codeceipt status` refuses a saved server address that is not https, as `last` already did (PH11-24).
    - `codeceipt last --json` answers only in a connected repo, never with the default login's project (PH11-25).
    - The command line shown must be `codeceipt` plus plain words (PH11-20).
    - The pop-up message cannot carry a link or an icon (PH11-21); more invisible characters are removed (PH11-22).
    - The extension runs nothing in a folder that is not a git repository.
    - The docs no longer say "nothing written": the command keeps its usual small records.
  - **Test input changed, openly:** PH11-05 (Windows finds only `codeceipt.exe`) used Unix-style folders for its
    Windows case; with the drive-letter rule it now uses `C:\...` folders. Its assertions are unchanged.
  - **Recorded in `agent/later.md`, not fixed here:** a `.git` folder that arrives in a zip file (not a clone) can
    carry a link file naming another of the same user's projects; the result is the wrong project's receipt shown,
    with no token sent anywhere new.

### Phase 12: measure, compare with the kit, document (docs only)
- **Measured** (`docs/performance.md`, section 6): 1,996 passing tests (baseline 1,537); full local gate about
  11 min 40 s and CI 13.5 min (baseline about 21 and 27.5 min); tool definitions 6,479 characters (baseline 10,247,
  budget 6,500); every hook between 102 and 148 ms on the Node bundle (baseline 520-565 ms).
- **Not measured:** the native binary, hooks against the real server, production latency, and tokens per real
  agent session. All need the release (owner action 8) or real sessions.
- **Kit comparison** (`docs/kit-migration.md`, "After the roadmap"): 13 of 22 kit areas are covered, 8 partly, 1
  not built (blocking `--no-verify` and force pushes). The page lists what to keep in the kit and the order to
  switch pieces off; nothing should be switched off before the release.
- **New page:** `docs/switching-from-a-build-kit.md`, for other projects that use a build kit.
- **Owner actions:** `docs/owner-actions.md` now starts with "Where to start", the 15 actions in the order to do
  them. No entry was removed or renumbered.
- **Left for later, on purpose** (all in `agent/later.md` or the phase notes above): automatic sync suggestions,
  maintainability flags on the receipt itself, email notifications (owner action 12), an AI check for vague claims,
  a debounce for pull-request events, the repository picker fix (needs the owner's go-ahead), and the
  extension-host test.

## Roadmap finished (2026-11-11)
Phases 0-12 are merged. What remains is the owner's: the 15 entries in [../owner-actions.md](../owner-actions.md),
starting with "Where to start". Ideas and deferred items are in `agent/later.md` and in the "Later" lines above.

### After the roadmap: repository picker fix (owner-approved 2026-11-11)
- Linking through the GitHub App now offers and accepts only repositories the signed-in person can access on GitHub
  (decision D-032). Attack tests in `apps/web/src/server/github-install.test.ts`.
- **Test helpers changed, openly:** the install tests now carry cookies from the callback to the selection screen, as
  a browser does (`cookieJar` in `github-test-helpers.ts`). No assertion changed.

