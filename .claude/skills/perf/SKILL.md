---
name: perf
description: "Measure and fix performance problems with numbers: N+1 queries, missing indexes, pagination, slow endpoints, bundle size. Report first, fix only what the user approves."
metadata:
  argument-hint: "[FEAT-ID or area]"
argument-hint: "[FEAT-ID or area]"
disable-model-invocation: true
---
# Performance pass
Target: $ARGUMENTS
(If `$ARGUMENTS` appears literally or is empty, the target is what the user wrote with this request; if nothing, check the whole app, slowest user flows first.)

Measure, don't guess. Every finding has a number before and (after a fix) a number after.
1. Run `python3 scripts/kit.py brief` unless the SESSION BRIEF is already in context. Start the app (`bash scripts/dev.sh`). List the flows of the target (`kit.py where <FEAT-ID>`).
2. Database: count queries per request (enable the ORM/driver query log or a counter in a test). More queries as the
   list grows = N+1. Run EXPLAIN (ANALYZE) on the 3 most used queries; flag sequential scans on large tables and
   filters/sorts without an index. Every list endpoint must paginate with a hard maximum.
3. Endpoints: time the key requests (a loop of curl/HTTP calls, or k6 if installed): p50/p95 at realistic data size.
4. Frontend (if any): production build output sizes per route, largest dependencies, images without size/lazy loading,
   waterfalls of requests on page load.
5. Work per request: unbounded loops, missing timeouts on outbound calls, work that belongs in a background job.
6. Report ranked by user impact with the numbers. Propose `perf` criteria (with numbers) via agent/plan.json and a
   budget command for VERIFY_PERF in scripts/verify.config (the human sets it). Fix only what the user approves; then
   show before/after numbers and run `bash scripts/verify.sh`.
