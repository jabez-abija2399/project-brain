---
name: change
description: "Record a changed requirement or new instruction and propose the plan change (agent/plan.json) before any code. Wait for approval, then import."
metadata:
  argument-hint: "<the change>"
argument-hint: "<the change>"
disable-model-invocation: true
---
# Change of mind / new requirement
Target: $ARGUMENTS
(If `$ARGUMENTS` appears literally or is empty, the target is what the user wrote with this request; if nothing, ask the user what changed.)

1. Run `python3 scripts/kit.py brief` unless the SESSION BRIEF is already in context. Do NOT touch code.
2. Append the instruction, dated, to agent/directives.md (verbatim or tight paraphrase).
3. List affected features, criteria and docs (`python3 scripts/kit.py show <FEAT-ID>`).
4. Write ONLY new or changed features/requirements to agent/plan.json (shape: agent/plan.example.json; keep existing
   ids; new criteria get the next free AC number; every feature keeps a negative/boundary/permission/attack criterion).
5. `python3 scripts/kit.py import --dry-run`; show its output and a before/after for every reworded criterion.
6. STOP and wait for approval. Then `python3 scripts/kit.py import`. Rewording existing criteria needs the human to run
   `SPEC_CHANGE_APPROVED=1 python3 scripts/kit.py import` themselves; tell them so.
