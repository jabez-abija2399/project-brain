# FEAT-003 Sign in with GitHub and private projects

## 1. Intent (what result the user actually wants, in 2-4 lines)
See the feature title and docs/product.md; this spec exists because the feature is security_sensitive.
Requirement ids: REQ-001   Non-goals for this feature: teams/sharing, email sign-in, billing

## 2. User flow and screens (numbered steps; link routes/pages)
1. Visitor opens / and clicks "Sign in with GitHub" (better-auth GitHub provider).
2. After callback, the user lands on /projects (empty state with "Create project").
3. Create project dialog: name (1-80 chars) -> /projects/:id.
4. Project settings: create token (shown once, copy button), list tokens (created date, last used), revoke with confirm.
5. Token-auth check: GET /api/token/whoami takes a project token (Authorization: Bearer <token>) and returns `{ project_id }` for a valid token or 401 for a missing/revoked token. Used by the CLI and MCP (and by the revocation test) to verify a token is still live.

## 3. Acceptance criteria (mirror agent/features.json; every criterion has a kind)
| ID | Kind | Observable behavior (testable) |
|----|------|--------------------------------|
| AC-003-01 | happy | A user signs in with GitHub, creates a project named 'demo' and sees it in the project list |
| AC-003-02 | permission | Signed-out requests to /api/projects/* return 401 |
| AC-003-03 | attack | User B requesting user A's project by id (GET /api/projects/<A-id>) gets 404, not 403 or 200 |
| AC-003-04 | attack | User B sending PATCH /api/projects/<A-id> with a new name gets 404 and the name is unchanged |
| AC-003-05 | negative | Creating a project with an empty name or a name over 80 characters returns 400 with a field error |
| AC-003-06 | happy | A revoked token is rejected with 401 by GET /api/token/whoami |
| AC-003-07 | boundary | Project tokens are stored only as hashes: the token value appears once in the create response and nowhere in the database |

## 4. Data and permissions
Entities: better-auth user/session/account tables; projects(owner_id FK NOT NULL, name NOT NULL 1-80); project_tokens(project_id FK, hash UNIQUE NOT NULL, last_used_at, revoked_at).
Authorization matrix: owner = all actions on own projects; other signed-in user = 404 on everything; anonymous = 401.

## 5. Threat model
Assets (what an attacker wants): project data of other users, project tokens, GitHub OAuth tokens, session cookies
Actors (anonymous, user, other user, admin, compromised dependency): anonymous visitor, signed-in other user, holder of a leaked or revoked token, compromised dependency
Entry points (routes, forms, uploads, webhooks, background jobs): /api/auth/* (better-auth), /api/projects/*, /api/projects/:id/tokens/*, /api/token/whoami
Abuse cases -> each becomes an `attack` or `permission` criterion with an executable test:
- IDOR: change :id to another user's project (AC-003-03, AC-003-04).
- Missing server authz: UI hides other projects but API allows it -> every route uses requireProjectAccess (AC-003-02).
- Token theft from DB: tokens stored as SHA-256 hashes only (AC-003-07).
- Revoked token reuse (AC-003-06).
- Mass assignment: PATCH body with owner_id is ignored (zod schema allows only name).
- Leakage: tokens and OAuth tokens never logged; session cookie httpOnly, secure, sameSite=lax.
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
