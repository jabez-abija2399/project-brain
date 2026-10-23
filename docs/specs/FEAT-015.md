# FEAT-015 Secret detector and RLS reviewer in receipts

## 1. Intent (what result the user actually wants, in 2-4 lines)
See the feature title and docs/product.md; this spec exists because the feature is security_sensitive.
Requirement ids: REQ-012   Non-goals for this feature: automatic fixing, history scanning of old commits

## 2. User flow and screens (numbered steps; link routes/pages)
1. During a receipt, changed client-side files are scanned with secret patterns (Supabase service_role JWT, sk_live_, Anthropic/OpenAI keys, private keys).
2. Supabase reader output (FEAT-005) is checked for RLS off and allow-all write policies.
3. Findings are added to the receipt with file:line and a fix hint.

## 3. Acceptance criteria (mirror agent/features.json; every criterion has a kind)
| ID | Kind | Observable behavior (testable) |
|----|------|--------------------------------|
| AC-015-01 | happy | A Supabase service-role key or a secret API key in a client-side file is flagged with file and line |
| AC-015-02 | negative | The Supabase anon key in client code is not flagged |
| AC-015-03 | attack | Detected secret values are masked (first 4 characters + ***) in receipts, API responses, the database and logs (test greps all four) |
| AC-015-04 | happy | Supabase tables with RLS disabled, or with a policy whose USING is 'true' for writes, are flagged in the receipt |
| AC-015-05 | boundary | A secret in .env.example with an empty value or a placeholder like 'your-key-here' is not flagged |

## 4. Data and permissions
receipts.summary_json.findings: [{type, file, line, masked_value, hint}]. No raw secret is ever stored.
Authorization: findings are part of receipts, visible to the project owner only (FEAT-003 rules).

## 5. Threat model
Assets (what an attacker wants): secrets accidentally committed by users
Actors (anonymous, user, other user, admin, compromised dependency): anonymous visitor, signed-in other user, holder of a leaked or revoked token, compromised dependency
Entry points (routes, forms, uploads, webhooks, background jobs): receipt generation (FEAT-013 job/tool), receipts API, logs
Abuse cases -> each becomes an `attack` or `permission` criterion with an executable test:
- Secret re-exposure through our own system: values masked before storing, returning or logging (AC-015-03).
- False positives that teach users to ignore warnings: anon key and placeholders not flagged (AC-015-02, AC-015-05).
- Missed RLS issues: RLS disabled and USING (true) on insert/update/delete flagged (AC-015-04).
Security pass (generate -> critique -> revise): after the first implementation, list "what would an attacker try next?", write
attacker tests, show them failing if vulnerable, fix, repeat once.

## 6. Performance budget
See the perf criteria above (if any) and docs/architecture.md Performance budget.

## 7. UI contract
Components from docs/DESIGN.md; all states (loading, empty, error, success); 375 and 1280 px.

## 8. Observability and errors
Log: route/tool name, project id, duration, result. Never log tokens, secrets, OAuth tokens or source code.
Errors: one AppError shape; 404 for anything the actor may not see.

## 9. Open questions / assumptions (label each)
- [ASSUME] v1 is single-owner projects; teams come later.
