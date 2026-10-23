---
name: bugfix
description: "Fix one bug without touching anything else: reproduce with a failing test, root cause, smallest fix, gate, report."
metadata:
  argument-hint: "<what happens vs what should happen>"
---
# Fix one bug
Target: $ARGUMENTS
(If `$ARGUMENTS` appears literally or is empty, the target is what the user wrote with this request; if nothing, ask the user for: what happens, what should happen, steps.)

1. Run `python3 scripts/kit.py brief` unless the SESSION BRIEF is already in context. If a UI bug lacks the page or screen size, ask once.
2. Find the owning feature: `python3 scripts/kit.py where <symbol or path>` / `kit.py where FEAT-x`.
3. Write a test (or browser script) that reproduces it. Run it and show it FAILING.
4. Root cause in one or two sentences.
5. `agent/scope.txt` with only the files to fix. Smallest fix. No refactors, no "while I'm here".
6. Show the test PASSING; `bash scripts/verify.sh`. UI: check 375 and 1280 px and say what you saw.
7. Anything else you noticed -> a row in agent/known-issues.md (severity HIGH/MEDIUM/LOW). Don't fix it.
8. Commit `<FEAT-ID> fix: <what>` (or `fix: <what>` if no feature owns it). Reply ONLY with:
```
TASK / STATUS | IMPLEMENTED | FILES CHANGED (flag any outside the plan)
VERIFIED (commands + results) | NOT VERIFIED | KNOWN ISSUES | NEXT TASK
```
