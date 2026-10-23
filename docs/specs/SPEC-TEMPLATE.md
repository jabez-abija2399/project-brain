# FEAT-xxx <title>   (copy to docs/specs/FEAT-xxx.md; REQUIRED when the feature is security_sensitive, has perf criteria, or is complex)

## 1. Intent (what result the user actually wants, in 2-4 lines)
Requirement ids: REQ-...   Non-goals for this feature:

## 2. User flow and screens (numbered steps; link routes/pages)

## 3. Acceptance criteria (mirror agent/features.json; every criterion has a kind)
| ID | Kind | Observable behavior (testable) |
|----|------|--------------------------------|
| AC-xxx-01 | happy | |
| AC-xxx-02 | negative | invalid/empty/duplicate input is rejected with message X |
| AC-xxx-03 | boundary | exact limits: 0, 1, max, max+1; empty list; page boundary; timezone/DST edge |
| AC-xxx-04 | permission | role/ownership matrix below is enforced server-side |
| AC-xxx-05 | attack | the abuse cases in section 5 fail (user A cannot read/modify user B's data, etc.) |
| AC-xxx-06 | state | loading, empty, error, success, disabled are all reachable and correct |
| AC-xxx-07 | perf | numeric target, e.g. "p95 < 300 ms for GET /items at 50 req/s with 10k rows" |
Kinds: happy negative boundary permission attack state perf. A feature cannot be marked done without at least one
negative/boundary/permission/attack criterion.

## 4. Data and permissions
Entities touched, fields, constraints (NOT NULL / UNIQUE / FK / indexes):
Authorization matrix (role x action x ownership):

## 5. Threat model (required if security_sensitive; otherwise one line "no new trust boundary")
Assets (what an attacker wants):
Actors (anonymous, user, other user, admin, compromised dependency):
Entry points (routes, forms, uploads, webhooks, background jobs):
Abuse cases -> each becomes an `attack` or `permission` criterion with an executable test:
- IDOR: change an id in the URL/body to another user's object
- Missing/weak authz on the server (UI hides it, API allows it)
- Injection (SQL/NoSQL/command/template), XSS, mass assignment, open redirect, SSRF, path traversal, unsafe upload
- Auth: brute force, enumeration (different message for unknown user), session fixation, token reuse/expiry
- Abuse: no rate limit, unbounded input size, expensive query, replay of a webhook/payment callback
- Leakage: secrets/PII in logs, errors, responses, client bundle
Security pass (generate -> critique -> revise): after the first implementation, list "what would an attacker try next?", write
attacker tests, show them failing if vulnerable, fix, repeat once.

## 6. Performance budget (required if perf criteria exist)
Expected load and data size: ...   Targets (numbers):
Query plan check: run EXPLAIN (ANALYZE) on the key queries; no sequential scan on tables above ~10k rows without a reason;
no N+1 (count queries per request in a test); lists are paginated; indexes exist for filter/sort columns.
Frontend: bundle/page weight budget, images optimized, Lighthouse CI thresholds (lighthouserc.json).

## 7. UI contract
Tokens/components used from docs/DESIGN.md; states; responsive behavior at 375/768/1280; accessibility notes.

## 8. Observability and errors
Log fields (no secrets/PII), error shape, metrics worth watching.

## 9. Open questions / assumptions (label each)
