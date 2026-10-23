---
name: kickoff
description: "Plan a new or existing project once: requirements, architecture, packages, boundaries, design, feature plan with testable criteria. Three stages, stops for approval after each."
metadata:
  argument-hint: "<your idea, or EXISTING CODEBASE>"
---
MY IDEA: $ARGUMENTS
(If `$ARGUMENTS` appears literally or is empty, the idea is what the user wrote with this request. Ask for it if none.)

You are running the kickoff for this project with the AI build kit. Read AGENTS.md and run python3 scripts/kit.py brief.
Do NOT write product code in this session. Work in 3 stages and STOP after each one for the user's answer.

## STAGE 1 - Understand (no files yet)
- Restate the product in <=5 lines. If the idea says EXISTING CODEBASE: first map it (tree, manifests, entry points,
  tests, `python3 scripts/kit.py dupes`) and base everything on what exists; mark what is already built.
- Ask at most 8 questions, each with your recommended default, so the user can reply "approve defaults". Cover only
  what changes the plan: users and roles, core flows, private data, integrations and accounts, hosting and budget,
  deadline, must-use or must-avoid technology, expected scale (users, data size).
STOP.

## STAGE 2 - Decide (write these files)
- docs/product.md: purpose, core flows, requirements REQ-001.. labelled [USER]/[TECH]/[ASSUME]/[OPEN] with defaults,
  scope out, roles, business rules, success criteria with numbers.
- Architecture: compare 2-3 real options in a table (cost, time to first deploy, operational load, risk, fit for the
  expected scale) and recommend one. Write docs/architecture.md for it, including "Reusable building blocks" (the
  shared modules every feature uses: auth guard, validation, data access, API client, error handling, UI kit). Record
  the choice as D-001 in docs/decisions.md (D-002.. for other contested choices).
- docs/boundaries.txt: 3-8 import rules the gate will enforce, e.g. UI never imports server/db code, features only use
  each other's public entry file, the data layer never imports the app.
- Packages: for each need, run python3 scripts/kit.py dep-check on your pick AND 2 alternatives; choose on maintenance,
  adoption, size, license, security history. Record the winners in docs/dependencies.md with "alternatives considered".
  Prefer well-known packages over writing code; never a package dep-check reports NOT FOUND.
- UI projects: docs/DESIGN.md with two short design directions (mark your recommendation), tokens, and the "Component
  inventory" (the shared components to build once and reuse). No UI: delete docs/DESIGN.md.
- Fill the PROJECT block of AGENTS.md (name, purpose, stack, commands, <=10 project rules), .env.example, and
  scripts/dev.sh (the one command that starts the app locally).
Report in <=15 lines: the choice and why, the riskiest assumption, what you would cut. STOP.

## STAGE 3 - Plan (write the plan; do not import it)
- agent/plan.json, same shape as agent/plan.example.json:
  * FEAT-001 is always a walking skeleton: project builds, tests run and print test names, one trivial endpoint or
    screen, scripts/dev.sh works, CI green.
  * Each feature fits ONE agent session (about half a day). Split anything bigger. Shared building blocks get built in
    the first feature that needs them, not duplicated later.
  * 3-8 acceptance criteria per feature, ids AC-<feat>-01..; each one observable and testable by a command, a test or
    a browser check; kinds: happy negative boundary permission attack state perf. Every feature has at least one
    negative/boundary/permission/attack criterion. Lists, search and heavy pages get a perf criterion with numbers.
  * security_sensitive: true for auth, permissions, payments, uploads, user-supplied code/URLs, secrets, PII. Those get
    attack/permission criteria and a spec docs/specs/FEAT-xxx.md from SPEC-TEMPLATE.md with the threat model filled.
  * Read KIT_MODE in scripts/verify.config. strict: plan an evaluator session per feature with UI or manual criteria.
  * Every REQ maps to at least one feature. depends_on keeps the order buildable. priority = build order.
- agent/later.md: every idea that was cut, one line each.
- Run python3 scripts/kit.py import --dry-run and fix every ERROR.
- Recommend the verify preset (auto, node, pnpm, pnpm-monorepo, python, go, rust) for the stack.
Show: the feature list (id, title, criteria count, flags) and anything you are unsure about. STOP.

After the user approves: run python3 scripts/kit.py import and python3 scripts/kit.py status, then tell the user the
exact commands only they may run:
  python3 scripts/kit.py config --stack <preset>
  python3 scripts/kit.py harden          (again after FEAT-001 creates package.json / pyproject.toml)
  git add -A && GUARD_ADMIN=1 git commit -m "chore: kickoff plan"
