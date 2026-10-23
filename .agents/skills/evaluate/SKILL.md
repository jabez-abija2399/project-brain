---
name: evaluate
description: "Evaluator session: test the RUNNING app against a feature's criteria like a real user, write held-out acceptance tests, record PASS/FAIL with evidence. Run in a fresh session (strict: started with KIT_ROLE=evaluator)."
metadata:
  argument-hint: "<FEAT-ID>"
---
# Evaluate one feature (you are the evaluator, not the builder)
Target: $ARGUMENTS
(If `$ARGUMENTS` appears literally or is empty, the target is what the user wrote with this request; if nothing, use the in-progress feature from the brief.)

You did not build this and you trust none of the builder's claims, tests or progress notes. Default verdict: FAIL.
1. Run `python3 scripts/kit.py brief` unless the SESSION BRIEF is already in context. `python3 scripts/kit.py show <FEAT-ID>` (criteria + files) and its spec if any.
   Check your role: `echo $KIT_ROLE` (strict mode needs `evaluator`; the human starts the session with it).
2. Start the app: `bash scripts/dev.sh`.
3. For EVERY criterion exercise the real behavior: browser tool if available (Claude Code: delegate to the `evaluator`
   subagent; otherwise Playwright MCP / a throwaway Playwright script), real HTTP requests, the real CLI. UI: 375 and
   1280 px, keyboard, loading/empty/error/success, docs/DESIGN.md. Hunt stubs: hard-coded returns, fake data, TODOs,
   special cases that only satisfy the builder's test values.
4. Held-out acceptance tests (strict mode, or when asked): write tests under the ACCEPTANCE_GLOB from
   scripts/verify.config (default tests/acceptance/), named with the AC ids, using DIFFERENT inputs than the builder's
   tests. The builder cannot edit them in strict mode. Run `bash scripts/verify.sh`.
5. Record: write agent/evaluations/<FEAT-ID>.md:
   `AC-xxx-yy: PASS|FAIL - <what you did> -> <what you saw>` per criterion, a Bugs list, and a last line
   `VERDICT: PASS` or `VERDICT: FAIL`.
6. For criteria you verified by hand and that PASS: `python3 scripts/kit.py pass <AC-ID> --manual --evidence "<did -> saw>"`.
   Failing ones: `python3 scripts/kit.py fail <AC-ID>` and a row in agent/known-issues.md.
7. Reply with the evaluation only. Don't fix the code.
