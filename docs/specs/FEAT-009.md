# FEAT-009 GitHub App: verified webhooks and incremental re-index

## 1. Intent (what result the user actually wants, in 2-4 lines)
See the feature title and docs/product.md; this spec exists because the feature is security_sensitive.
Requirement ids: REQ-006, REQ-015   Non-goals for this feature: commit/PR comments (later.md), web-builder rules export

## 2. User flow and screens (numbered steps; link routes/pages)
1. Project settings -> "Connect GitHub" -> GitHub App install page -> repo selection.
2. Callback stores installation_id + repo_full_name on the project (owner only).
3. Push to default branch -> POST /api/github/webhook -> verify signature -> Inngest event -> job fetches changed files via installation token, parses in memory, upserts metadata, discards contents.

## 3. Acceptance criteria (mirror agent/features.json; every criterion has a kind)
| ID | Kind | Observable behavior (testable) |
|----|------|--------------------------------|
| AC-009-01 | happy | Installing the GitHub App on a repo links it to the user's project (repo selection screen) |
| AC-009-02 | happy | A push to the default branch triggers an Inngest job that re-indexes only the changed files |
| AC-009-03 | attack | A webhook with a missing or wrong signature returns 401 and enqueues nothing |
| AC-009-04 | attack | A replayed webhook delivery id is ignored (processed at most once) |
| AC-009-05 | state | After the job, no source code is stored: the job parses files in memory and saves only metadata |
| AC-009-06 | perf | Re-indexing a push that changes 10 files completes in under 10 s (job duration logged) |

## 4. Data and permissions
Entities: projects.installation_id, projects.repo_full_name; webhook_deliveries(delivery_id UNIQUE, received_at) for replay protection; files/symbols upserts.
Authorization: the installation must belong to a project whose owner completed the install flow; jobs act only on that project.

## 5. Threat model
Assets (what an attacker wants): GitHub App private key, installation tokens, users' private repositories
Actors (anonymous, user, other user, admin, compromised dependency): anonymous visitor, signed-in other user, holder of a leaked or revoked token, compromised dependency
Entry points (routes, forms, uploads, webhooks, background jobs): /api/github/callback, /api/github/webhook, Inngest job index-push
Abuse cases -> each becomes an `attack` or `permission` criterion with an executable test:
- Forged webhooks: HMAC SHA-256 verification with GITHUB_WEBHOOK_SECRET before any work (AC-009-03).
- Replay of a delivery (AC-009-04).
- Linking someone else's installation to my project: callback checks the state parameter and that the signed-in user is the project owner.
- Source persistence: job stores metadata only (AC-009-05); file contents never logged.
- Abuse: pushes with > 500 changed files are split into steps; job concurrency 1 per project.
Security pass (generate -> critique -> revise): after the first implementation, list "what would an attacker try next?", write
attacker tests, show them failing if vulnerable, fix, repeat once.

## 6. Performance budget
See the perf criteria above (if any) and docs/architecture.md Performance budget.

## 7. Webhook response contract
POST /api/github/webhook returns: 202 Accepted (`{ ok: true, enqueued: true }`) once the signature verifies and the Inngest event is enqueued; 200 OK (`{ ok: true, duplicate: true }`) for a replayed delivery id; 401 (`{ error: "bad_signature" }`) if the X-Hub-Signature-256 header is missing or does not match (no body is parsed before the check); 400 for an unknown event type we do not handle. The handler always responds within 2 s; any real work runs in the Inngest job.

## 8. Observability and errors
Log: route/tool name, project id, duration, result. Never log tokens, secrets, OAuth tokens or source code.
Errors: one AppError shape; 404 for anything the actor may not see.

## 9. Open questions / assumptions (label each)
- [ASSUME] v1 is single-owner projects; teams come later.
