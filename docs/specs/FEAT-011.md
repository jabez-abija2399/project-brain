# FEAT-011 Remote MCP server with authenticated tools

## 1. Intent (what result the user actually wants, in 2-4 lines)
See the feature title and docs/product.md; this spec exists because the feature is security_sensitive.
Requirement ids: REQ-004, REQ-008   Non-goals for this feature: write tools for checklists/receipts (FEAT-012/013 add them), OAuth dynamic client registration UI polish

## 2. User flow and screens (numbered steps; link routes/pages)
1. User adds the MCP URL + token to their agent (FEAT-016 automates this).
2. Agent connects to /mcp; server authenticates the bearer token (or better-auth OAuth access token).
3. Agent calls tools; each tool validates input with zod and calls server services scoped to the token's project.
   projectId is optional in every tool (the token names the project); when given it must be the token's project, otherwise not_found (dogfooding 2026-10-29). list_features returns the project's features (name, primary file count, status; at most 200, with total and truncated).

## 3. Acceptance criteria (mirror agent/features.json; every criterion has a kind)
| ID | Kind | Observable behavior (testable) |
|----|------|--------------------------------|
| AC-011-01 | happy | An MCP client (Claude Code) connects to /mcp and lists the tools where_did_we_stop, get_context_pack, find_similar_component, list_features, save_progress, add_decision |
| AC-011-02 | permission | Connecting without credentials, or with a revoked token, fails with 401 |
| AC-011-03 | attack | A token for project A calling any tool with project B's id returns a not-found error and no data |
| AC-011-04 | happy | get_context_pack(feature) returns the feature's files, component summaries, decisions and rules, without source code |
| AC-011-05 | perf | where_did_we_stop, get_context_pack and find_similar_component answer in under 500 ms p95 with 0 LLM calls |
| AC-011-06 | negative | Tool calls with invalid arguments return a validation error naming the field |

## 4. Data and permissions
Reads: features, feature_files, files, symbols, decisions, agent_sessions, checklist_items. Writes: agent_sessions (save_progress), decisions (add_decision).
Authorization: token -> one project; any project id in arguments must equal it, else not-found.

## 5. Threat model
Assets (what an attacker wants): every project's Brain data, tokens
Actors (anonymous, user, other user, admin, compromised dependency): anonymous visitor, signed-in other user, holder of a leaked or revoked token, compromised dependency
Entry points (routes, forms, uploads, webhooks, background jobs): /mcp (HTTP transport), all tool calls
Abuse cases -> each becomes an `attack` or `permission` criterion with an executable test:
- Unauthenticated or revoked access (AC-011-02).
- Cross-project access by passing another id (AC-011-03).
- Prompt injection: tool outputs contain user-written text (decisions, summaries); outputs are labelled as data, never as instructions, and tools never execute content.
- Expensive calls: read tools have no LLM calls and result size caps (context pack <= 8,000 chars) (AC-011-05).
- Leakage: no source code in any tool output; errors never include stack traces.
Security pass (generate -> critique -> revise): after the first implementation, list "what would an attacker try next?", write
attacker tests, show them failing if vulnerable, fix, repeat once.

## 6. Performance budget
See the perf criteria above (if any) and docs/architecture.md Performance budget.

## 7. MCP error shape
Tool errors return a JSON-RPC error with `code` and `message` fields and no stack trace. Codes used: -32602 invalid params (field name in `data.field`), -32001 unauthorized (missing/invalid/revoked token), -32004 not_found (project id does not match the token's project; also used for cross-project reads so existence is never leaked), -32005 rate_limited (`data.retry_after_s`), -32603 internal (opaque; details only in server logs). Transport-level auth failures surface as HTTP 401 before any JSON-RPC frame is parsed.

## 8. Observability and errors
Log: route/tool name, project id, duration, result. Never log tokens, secrets, OAuth tokens or source code.
Errors: one AppError shape; 404 for anything the actor may not see.

## 9. Open questions / assumptions (label each)
- [ASSUME] v1 is single-owner projects; teams come later.
