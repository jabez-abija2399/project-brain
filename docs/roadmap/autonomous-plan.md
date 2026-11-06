# Autonomous roadmap (owner's prompt, saved verbatim on 2026-11-06)

You are running a long autonomous build of Codeceipt in this repository. The owner has no local computer access for a while and will not be able to answer questions quickly. Plan everything first, then keep working, phase after phase, until the whole roadmap below is done. Do not stop to ask the owner unless something is truly impossible without them; record it and continue with other work.

## How to work (owner's workflow decisions; these replace any conflicting workflow habits)
- First, save this entire prompt as docs/roadmap/autonomous-plan.md, and create docs/roadmap/progress.md: an ordered list of every phase and track below with status (not started, in progress, merged, blocked), the PR link, and a one-line result. Update progress.md at the start and end of every phase. If your context gets long or a new session starts, re-read these two files and continue from the first unfinished item; never redo merged work.
- Plan before building: for each phase, write a short plan into progress.md (what exists already, the gaps, the PRs you'll open), then build.
- Work through phases in order without waiting for the owner. Several phases in one session are fine. One pull request per phase (or per track).
- Use sub-agents: for the fresh-context /security checks and reviews of each PR, for independent research of current agent documentation (Claude Code, Cursor, Codex, OpenCode, Antigravity), and for independent parts of a phase that don't touch the same files. Keep your own context small: sub-agents return short summaries.
- Merge each PR yourself once CI is green (wait for CI; never merge red or unfinished CI). If CI fails, fix it and push again. If main is red for a reason outside your PR, fix main first in its own small PR.
- Never weaken, bypass or disable any AI Build Kit protection, hook or CI check, and never set GUARD_ADMIN, KIT_BASE, SPEC_CHANGE_APPROVED or other human-only variables. When work needs a human-owned file (CI workflows, scripts/verify.sh, release or signing files, other protected files), a human-only approval, a release, a production database change, a secret, an account or a marketplace submission: write the exact ready-to-apply change into docs/owner-pending/ and add a numbered entry to docs/owner-actions.md with plain, step-by-step instructions the owner can follow later (prefer steps doable on the GitHub website from a phone), what it unblocks, and how to verify it. Then continue with any work that doesn't depend on it. Never stop just because an owner action is pending.
- Never change the production database, never publish a release, never touch secrets or signing keys.

## Standard rules for every PR
Follow docs/build-checklist.md, failing tests first. Branch from the latest main and merge main in before opening the PR. Invisible and lookalike characters are \u escapes; only append to agent/*.md files. New migrations use a number three above the highest on main. New packages need a dep-check and a row in docs/dependencies.md. Run the /security checks in a fresh-context sub-agent and fix what they find. Run python3 scripts/kit.py check. Use verify --quick during fix loops if it exists; run the full verify once before opening each PR. End each PR with a "How to test this for real" checklist (5 steps or fewer). If the CLI changed, bump its version as docs/publishing.md describes and add a release entry to docs/owner-actions.md (tag, approve, update cli-release.json).

## Rules for every phase
- Build on what exists; extend, never duplicate. Before each phase, check what's already built and implement only the gaps.
- Performance budgets (non-negotiable; enforced by tests or a CI check; re-measured against the baseline in each PR): start note within about 500 tokens with priority order; MCP tool definitions no larger than the baseline; compact tool answers with only needed fields and a "more available" hint; session-start hook under 300 ms with the server reachable (never more than 2 s otherwise, using a cached note); the prompt hook never blocks the user; stop, pre-tool-use and approval checks under 200 ms with no AI calls; pre-commit check under 2 s; MCP reads p95 under 150 ms using data precomputed at index time.
- Context engineering: the smallest set of high-signal tokens; pointers instead of pasted content; nothing repeated across the start note, AGENTS.md and tool answers.
- Code-free (D-002): only paths, names, symbol names, short summaries, counts and test names leave the user's machine.
- Enforcement in Codeceipt, not in instructions: approvals, boundaries and policies are enforced by Codeceipt's server, hooks and CLI. An agent using Codeceipt can never approve its own requests or change a policy.
- Honest evidence: never more certainty than the evidence supports; unclear is "not proven", never "done"; never claim unmeasured savings.
- Easy for everyone: plain language in the Simple view, technical detail in the Detailed view. Every user action is available on the web, in the CLI (short command, plain output, --json) and through agent chat, listed in docs/actions.md. Every error says what happened and the exact fix.
- Untrusted data: anything from users, imported files, discovered names or AI answers is masked and never treated as instructions; prompt injection is the main security risk.

## Roadmap, in order

### Phase 0: audit (no product code)
1. Inventory every AI Build Kit practice in this repository (agent/features.json criteria and pass records, progress handoff, decisions, directives, known issues, later.md, scope.txt, protected files and boundaries, human-only spec approvals, the kit guard on skipped/focused tests and changed assertions, verify.sh as a gate, dependency checks and the 7-day cooldown, the report format, /feature and /bugfix workflows, fresh-context security passes and peer reviews, docs/build-checklist.md rules, file size limits) and every existing Codeceipt feature (including anything already built of the items below). Write docs/kit-migration.md mapping each kit practice to its Codeceipt feature with status and gap.
2. Baselines in docs/performance.md: this repository's verification times (local and CI, per step and package), and Codeceipt's footprint (tokens added to an agent session; timing of every hook, CLI command and MCP read).

### Phase 1: finish fast verification
Continue the work on branch speedup/verify-scripts and PR #53 (read docs/performance.md and docs/verify-speedup/): find out why CI hasn't run on PR #53 and fix it; quick mode = changed packages' own tests, typecheck and lint for changed packages and dependents, and dependents' tests only when files in that dependent changed (owner decision); use the migrated-template test database in the web tests too and tune Vitest workers; split CI into parallel jobs keeping every existing check; update AGENTS.md and docs/build-checklist.md. Changes to scripts/verify.sh and CI workflows are human-owned: prepare them in docs/owner-pending/ and add owner actions. Report timings against the baseline.

### Phase 2: Codeceipt's footprint and speed
Bring Codeceipt within the budgets: fixed-budget start note with pointers, consolidated MCP tools with short descriptions and compact answers (backwards compatible for one release), context packs precomputed at index time and cached, fast hooks with cached fallbacks. Report numbers against the baseline.

### Phase 3: Project Blueprint
1. A versioned Blueprint per project with history and one-click restore; features (purpose, build order, depends_on, status, mapped areas and files, linked tests); criteria with a plain sentence plus a structured EARS-style form behind it (WHEN ... THE SYSTEM SHALL ..., IF ... THEN ..., THE SYSTEM SHALL NOT ...), a kind (behaviour, must-never, security) and a proof status (proven by a passing or linked test, done but not proven, not proven, contradicted); at least one must-never or security criterion per feature; ambiguity and contradiction flags with suggested rewrites; rules, decisions and boundaries (protected paths, allowed and disallowed dependencies).
2. Three ways to start: Discover for existing projects (an as-built Blueprint from the index: features, components, routes, Supabase tables and RLS flags, tests, dependencies, README and AGENTS.md; confirmed one feature at a time; then goals), a short interview for new ideas (at most 8 questions with suggested answers, extending plan_project), and import (Phase 8).
3. Safety check on Discover: the most important existing risks with "Fix with my agent".
4. Simple and Detailed views, chosen by "Do you usually read the code your AI writes?", switchable, remembered; accessible at 375 and 1280 px.
5. Acceptance on a realistic Next.js and Supabase fixture and a Vite (Lovable-style) fixture.

### Phase 4: follow the Blueprint and get it right the first time
1. Start note and context pack within budget: next feature, its criteria, rules and boundaries; context packs as ranked maps (files with one-line summaries, components to reuse, decisions).
2. Definition of done on each captured request: matching criteria and checklist items, must-never items, past misses in the same feature, relevant tests; ambiguous requests tell the agent to ask one question first.
3. "Prove it" test runs (opt-in per project): only tests linked to the changed files and the request's criteria, with a time limit; only counts and failing test names are sent.
4. Done gate on each agent's stop event where it exists (check current docs): a deterministic check with no AI for open criteria with no matching change, code without a test when required, boundary files changed without approval, failing related tests when "prove it" is on; tell the agent what's missing at most 2 times per session, respecting stop_hook_active, then report the rest. Modes: gentle (default), strict, off.
5. Receipts check each session against the Blueprint: progress per feature, newly proven criteria, boundary changes, dependencies contradicting decisions, regressions (tests deleted or skipped for proven criteria).
6. "Review here first": every receipt ranks at most 3 places to check first, each with a reason, from existing evidence only.

### Phase 5: Codeceipt Guard
1. Blocking boundaries through each agent's pre-tool-use hook, applying the approval policy (Phase 6); document where blocking isn't possible.
2. `codeceipt guard --staged` (pre-commit, offered at setup, never installed silently) and `codeceipt guard --ci`, checking only changed files: no newly skipped, focused or deleted tests, no weakened assertions, no secrets, no raw invisible or lookalike characters, no files outside the request's boundaries without approval, size limits; plain explanations with the exact fix; gentle, strict, off; under 2 s.

### Phase 6: flexible approval policies
1. Risk levels for every action needing a decision, with defaults, listed in docs/approvals.md: low (auto: wording fixes, adding criteria, linking tests, postponing or closing items, adding decisions), medium (auto and tell me: changing a criterion's meaning, adding dependencies, adding protected folders, renaming or merging features, new "prove it" commands), high (ask: removing criteria, deleting features, approving plans or imports, public sharing, editing protected files, PR comments on public repos), locked (always ask, never automatic: removing security or must-never criteria, removing protected paths, turning off the done gate or Guard, changing the approval policy).
2. Choices per action: never allow, always ask, auto and tell me, auto; evaluated never, then ask, then auto; first match wins; rules scoped by action, feature, path pattern and agent.
3. Presets: Careful, Balanced (default), Fast; locked actions always ask. Simple view shows presets; Detailed view shows the table and rules.
4. Remembered choices (approve once, always approve this kind, reject, always reject), focus mode (1, 2 or 4 hours), pause button (web and `codeceipt pause`), one-click undo of automatic approvals and a daily summary, approvals on the web (mobile-friendly), CLI and from links in agent chat, email and browser notifications with batch approval, agents continue working while approvals are pending, expiry after 24 hours by default.
5. Only the owner changes policies; loosening asks for confirmation, tightening is instant; agents can never approve, change or bypass a policy; append-only audit log; storage ready for team roles later.

### Phase 7: kit workflows as product features
1. Plugin commands /codeceipt-feature, /codeceipt-fix, /codeceipt-review: Blueprint-aware, within boundaries, failing test first when required, one question if ambiguous, approval-policy aware, related tests only, ending with an honest report matching the receipt.
2. Second-opinion review for sensitive sessions or on request: a fresh-context session or sub-agent with only the receipt, criteria and changed file names; findings recorded in the receipt.
3. Rule packs from docs/build-checklist.md ("Security basics", "Supabase safety", "Test discipline", "Small files", "Fast checks"), switchable, used by the Blueprint, start note, done gate and Guard.
4. Maintainability flags for files past a size limit and very large changes.

### Phase 8: import, export and sync
1. Importers (high-risk approval, untrusted data, linked to source lines): this kind of build kit (agent/features.json, docs/decisions.md, agent/directives.md, agent/known-issues.md, agent/later.md, docs/boundaries.txt, AGENTS.md rules), GitHub Spec Kit, Kiro, OpenSpec, AGENTS.md, CLAUDE.md, README. Test the kit importer on this repository's real files.
2. Export: a managed AGENTS.md section (never touching user text), plus OpenSpec and Spec Kit formats.
3. Sync after each index or GitHub push: Blueprint versus code differences as suggestions, applied only through the approval policy.

### Phase 9: easy everywhere
Action parity across web, CLI and agent chat with a test that fails when an action is missing; `codeceipt` with no arguments opens a simple keyboard menu (pending approvals and next step first) or starts setup; one next step shown identically everywhere; sign-up asks "How do you build?" and shows only the matching setup and the Balanced preset; every CLI and agent answer links to the web item, and every web page shows the matching command and an "Ask your agent" phrase.

### Phase 10: claim checker and pull request receipts
1. Claim checker: at session end, read only the agent's final summary from the local session record where available, split it into claims with at most 1 AI call (masked, labelled user data), check each against the diff and the session's findings: confirmed, contradicted, cannot check (never shown as confirmed); "Claimed vs actual" in receipts, codeceipt last and the dashboard; contradicted claims go into "Send fix to agent"; never send the transcript.
2. Pull request receipts through the GitHub App, off by default per repository: request from the PR title, description and linked issue; changes from the PR diff analysed in memory with the same code-free rules; one comment updated in place plus a neutral check run; on public repositories only summary counts; never on fork PRs without approval. GitHub App permission changes are an owner action.

### Phase 11: VS Code extension
CLI `--json` for last and status and a local last-receipt file the CLI writes; a packages/vscode-extension (also for Cursor and Windsurf) that watches that file: sidebar receipt with clickable files, open and postponed items with "Send fix to agent", status bar summary, notification on new receipts, set-up and dashboard commands, install help when codeceipt is missing; strict content security policy; tests with @vscode/test-electron; a .vsix and docs/vscode-extension.md. Publishing is an owner action.

### Phase 12: measure, compare with the kit, document
Counts from the agent's local session record (tokens, tool calls, files read, duration) attached to receipts; tokens and time per session, first-pass success, done gate and Guard help, automatic versus asked approvals, criteria proven over time, compared only within the project's own sessions. Update docs/kit-migration.md with real results so the owner can switch kit pieces off; final performance report against the baselines; plain-language docs for everything above, including "Switching from a build kit to Codeceipt".

## When everything is done
Make sure docs/roadmap/progress.md shows every item merged or blocked with its reason, and docs/owner-actions.md lists every pending owner action in the order the owner should do them, each with exact steps and how to verify it. Then stop and write a short plain-language summary: what was built, what's waiting for the owner, and what to test first.
