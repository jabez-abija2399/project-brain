---
name: security
description: "Security pass on one feature: threat model, executable attacker tests, fix, critique, repeat."
metadata:
  argument-hint: "<FEAT-ID>"
---
# Security pass
Target: $ARGUMENTS
(If `$ARGUMENTS` appears literally or is empty, the target is what the user wrote with this request; if nothing, use the most recent security_sensitive feature from `kit.py status`.)

1. Run `python3 scripts/kit.py brief` unless the SESSION BRIEF is already in context. `python3 scripts/kit.py show <FEAT-ID>` and its spec threat model (create it from
   docs/specs/SPEC-TEMPLATE.md if missing).
2. Entry points and trust boundaries of this feature (`kit.py where <FEAT-ID>` lists its files).
3. Abuse cases per entry point: IDOR (another user's id), missing server-side authz, injection (SQL/command/template),
   XSS, SSRF, mass assignment, open redirect, path traversal, enumeration, brute force, replay, unbounded input,
   secrets or PII in logs/errors/responses/client bundle.
4. Write executable attacker tests; show the ones that FAIL (= vulnerabilities). Fix them.
5. "What would an attacker try next?" Add tests, fix again.
6. `bash scripts/verify.sh`. Propose new attack/permission criteria via agent/plan.json (human approves; you import).
7. Reply ONLY with:
```
TASK / STATUS | IMPLEMENTED | FILES CHANGED (flag any outside the plan)
VERIFIED (commands + results) | NOT VERIFIED | KNOWN ISSUES | NEXT TASK
```
