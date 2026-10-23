---
name: audit
description: "Independent pre-release audit of the whole app as attacker and reviewer; reports to known-issues, fixes nothing."
disable-model-invocation: true
---
# Pre-release audit (fresh session, ideally a different model)
1. Trust nothing in agent/progress.md. `bash scripts/verify.sh`; `python3 scripts/kit.py status`.
2. Start the app (`bash scripts/dev.sh`). Spot-check at least 5 done features against their criteria in the running app.
3. Attack with real requests or tests: other users' data by changing ids, every route signed out, injection in every
   input, secrets in code and git history (`gitleaks detect` if installed), every limit exceeded.
4. Also: unproven criteria, "done" features that are partial, `python3 scripts/kit.py dupes`, N+1 queries and missing
   indexes, slow pages, UI that ignores docs/DESIGN.md, stale docs.
5. Add findings with evidence to agent/known-issues.md (the only file you may edit), HIGH first. Fix nothing.
