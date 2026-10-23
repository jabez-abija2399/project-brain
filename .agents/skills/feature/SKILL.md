---
name: feature
description: "Build one feature from agent/features.json with the kit routine: plan, scope, reuse, tests per acceptance criterion, verify gate, pass/done, commit, report. Use when the user says build/implement/next feature or gives a FEAT id."
metadata:
  argument-hint: "[FEAT-ID]"
---
# Build one feature
Target: $ARGUMENTS
(If `$ARGUMENTS` appears literally or is empty, the target is what the user wrote with this request; if nothing, build the NEXT feature from the brief.)

## 1. Understand (cheap)
1. Run `python3 scripts/kit.py brief` unless the SESSION BRIEF is already in context. Follow AGENTS.md. One feature per session.
2. `python3 scripts/kit.py show <FEAT-ID>`: criteria, spec, files so far. Read `docs/specs/<FEAT-ID>.md` if listed.
   If notes say EXPAND BEFORE STARTING, propose fuller criteria via `agent/plan.json` (see the change skill) and stop.
3. If verify is failing or an open HIGH known issue exists, fix that first.

## 2. Reuse before you write (this is where most waste and duplication comes from)
- `python3 scripts/kit.py where <name>` and `rg -n` for every component, util, service, schema or hook you are about
  to create. Extend what exists; never create a second version.
- UI: use the components listed in docs/DESIGN.md "Component inventory"; add a new shared component there only when
  nothing fits, and make it generic (props, no feature logic inside).
- Logic: put shared code in the "Reusable building blocks" from docs/architecture.md, not inside one feature.
- Libraries: prefer a package from docs/dependencies.md over own code. New package: `python3 scripts/kit.py dep-check
  <name>` for it AND 2 alternatives, pick on maintenance, size, license, adoption; add a row (with "alternatives
  considered") to docs/dependencies.md, then install.

## 3. Plan (<=6 lines), then `agent/scope.txt` (one glob per line), then `python3 scripts/kit.py start <FEAT-ID>`

## 4. Build: only what the criteria require (ideas -> one line in agent/later.md)
- Layers: thin entry point (route/handler/command/screen) -> service (rules) -> data. No business logic in UI.
- Respect docs/boundaries.txt (the gate enforces it). Modules talk through their public entry file. Files <=300 lines.
- Security: server-side authorization on every entry point (never trust ids/roles/prices from a client); validate
  every input at the boundary; parameterized queries/ORM only; no shell strings built from input; secrets only via
  env (+ name in .env.example), never in logs, errors or client code; rate-limit auth and expensive endpoints.
- Performance: paginate every list; no query inside a loop (N+1); index the columns you filter/sort on; no unbounded
  work per request; lazy-load heavy UI. Perf criteria need a measured number.
- UI: docs/DESIGN.md tokens only (no hard-coded colors); loading, empty, error and success states; keyboard focus and
  labels; check 375 px and 1280 px.

## 5. Test
- One focused test per criterion; its name starts with the AC id (e.g. `AC-003-02 rejects ...`). Exact assertions.
- `attack`/`permission` criteria: a real test that performs the attack and shows it fails.
- Never delete, skip or weaken a test (the gate checks assertions, skips, test config and the passing-test count).
- Iterate: `bash scripts/verify.sh --quick`. Finish: `bash scripts/verify.sh` once.

## 6. Prove and finish
1. `python3 scripts/kit.py pass <AC-ID>` per criterion (the log must show the AC id). Browser/server-only criteria:
   fast mode `--manual --evidence "<what you did and saw>"`; strict mode: the human runs `/evaluate` in a fresh
   KIT_ROLE=evaluator session. Claude Code: you may ask the `evaluator` subagent to check the running app first.
2. `python3 scripts/kit.py done <FEAT-ID>` (records the feature's files and the test baseline).
3. Add the agent/progress.md entry at the top (<=8 lines: changed, verified, NOT verified, open questions, next).
4. `git add -A && git commit -m "<FEAT-ID>: <what>"` (the id at the start keeps `kit.py where` accurate).
5. Final reply is ONLY:
```
TASK / STATUS | IMPLEMENTED | FILES CHANGED (flag any outside the plan)
VERIFIED (commands + results) | NOT VERIFIED | KNOWN ISSUES | NEXT TASK
```
