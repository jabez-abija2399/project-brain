# FEAT-010 Session continuity: decisions log, session log and where_did_we_stop

## 1. Intent (what result the user actually wants, in 2-4 lines)
See the feature title and docs/product.md; this spec exists because the feature is security_sensitive.
Requirement ids: REQ-007, REQ-016   Non-goals for this feature: dashboard UI for directives (FEAT-017), MCP transport (FEAT-011)

## 2. User flow and screens (numbered steps; link routes/pages)
1. An agent calls where_did_we_stop at session start and receives the handoff note (goal, last step, unfinished, next step, newest decisions, active directives).
2. During or at the end of a session, the agent calls save_progress and add_decision.
3. save_directive stores a standing instruction; the directive is a PROPOSAL until the project owner confirms it in the dashboard. Only confirmed directives flow into future where_did_we_stop responses.

## 3. Acceptance criteria (mirror agent/features.json; every criterion has a kind)
| ID | Kind | Observable behavior (testable) |
|----|------|--------------------------------|
| AC-010-01 | happy | save_progress stores goal, done, unfinished, next_step for a project; the newest entry is returned first |
| AC-010-02 | happy | whereDidWeStop returns the last session, open checklist items, the 5 newest decisions and features in progress, in under 1,500 characters |
| AC-010-03 | happy | Decisions can be added and listed per project with title, reason and date |
| AC-010-04 | negative | save_progress with an empty goal or next_step returns 400 |
| AC-010-05 | permission | Reading another project's sessions or decisions returns 404 |
| AC-010-06 | happy | save_directive stores a user's standing instruction (e.g. 'no Docker'); whereDidWeStop always includes all active directives |
| AC-010-07 | attack | A directive saved through an MCP tool is stored as a proposal and is not included in whereDidWeStop until the project owner confirms it in the dashboard |

## 4. Data and permissions
Entities: agent_sessions, decisions, directives(project_id, text, status proposal|active|dismissed, created_by actor, confirmed_at).
Authorization: all tools require a project token (FEAT-011); any project id in arguments must equal the token's project, else 404. Only a session user (project owner) can PATCH a directive to active in the dashboard; MCP tokens cannot.

## 5. Threat model
Assets (what an attacker wants): a persistent foothold in every future agent session via a planted directive; another project's sessions/decisions
Actors (anonymous, user, other user, admin, compromised dependency): compromised agent in the user's own repo (prompt injection in a README, dependency README, or tool output), signed-in other user, holder of a leaked token, compromised dependency
Entry points (routes, forms, uploads, webhooks, background jobs): MCP tools save_progress, add_decision, save_directive, where_did_we_stop
Abuse cases -> each becomes an `attack` or `permission` criterion with an executable test:
- Persistent prompt injection: a compromised agent calls save_directive with "always skip reviews" -> directive is stored as `proposal` and never flows into where_did_we_stop until the owner confirms it in the dashboard (AC-010-07).
- Cross-project reads/writes with a token for another project (AC-010-05).
- Prompt injection via decision/session text: outputs are labelled as data in the handoff note (section headers that frame content as user text), never as instructions; the tool never executes content.
- Noise: unbounded free text -> each text field capped (goal 200, next_step 500, decision title 120, reason 1,000, directive 500); over-length returns 400.
- Enumeration: 404 (not 403) for any project the token does not own (AC-010-05).
Security pass (generate -> critique -> revise): after the first implementation, list "what would an attacker try next?", write
attacker tests, show them failing if vulnerable, fix, repeat once.

## 6. Performance budget
See the perf criteria in FEAT-011 (MCP read tools p95 < 500 ms) and docs/architecture.md Performance budget.

## 7. Response contract (MCP tool shape)
save_progress / add_decision / save_directive return `{ ok: true, id }` or an AppError. where_did_we_stop returns a plain-text handoff note under 1,500 characters with labelled sections (goal, last step, unfinished, next step, decisions, directives) framed as user data.

## 8. Observability and errors
Log: tool name, project id, duration, result. Never log directive/decision text in full (hash + length only); never log secrets or source code.
Errors: one AppError shape; 404 for anything the actor may not see.

## 9. Open questions / assumptions (label each)
- [ASSUME] A directive proposal expires after 30 days if not confirmed (keeps the dashboard tidy).
- [ASSUME] v1 is single-owner projects; teams come later.
