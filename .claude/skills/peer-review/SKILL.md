---
name: peer-review
description: "Independent code review of one feature by a fresh session, ideally a different model; writes agent/reviews/FEAT-x.md with a VERDICT."
metadata:
  argument-hint: "<FEAT-ID>"
argument-hint: "<FEAT-ID>"
disable-model-invocation: true
---
# Independent review
Target: $ARGUMENTS
(If `$ARGUMENTS` appears literally or is empty, the target is what the user wrote with this request; if nothing, ask which feature.)

1. `python3 scripts/kit.py review-pack --feat <FEAT-ID>`.
2. You did not write this code; don't guess who did. Read agent/review-pack.md and only the files it references.
   Do NOT read agent/progress.md.
3. Review: criteria really satisfied; test quality (weak assertions, missing boundaries, mocks of the code under test,
   happy path only, special-casing of test values); security (authz/IDOR, validation, injection, leaks, rate limits);
   architecture (layers, docs/boundaries.txt, duplication via `kit.py dupes` and `kit.py where <symbol>`, logic in UI,
   reuse of DESIGN.md components); performance (N+1, indexes, pagination, unbounded work, bundle weight).
4. You may run tests. EVERY finding needs evidence: a failing test you ran, or file:line + a concrete scenario.
   Drop findings without evidence. Don't modify source files.
5. Write agent/reviews/<FEAT-ID>.md ranked HIGH/MEDIUM/LOW, ending with exactly one line:
   `VERDICT: PASS` (no HIGH or MEDIUM with evidence) or `VERDICT: FAIL`.
   (Strict mode: the human starts this session with KIT_ROLE=reviewer so the file can be written.)
