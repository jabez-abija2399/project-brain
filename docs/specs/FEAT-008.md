# FEAT-008 CLI: projectbrain login + index

## 1. Intent (what result the user actually wants, in 2-4 lines)
See the feature title and docs/product.md; this spec exists because the feature is security_sensitive.
Requirement ids: REQ-005, REQ-015   Non-goals for this feature: agent setup (FEAT-016), GitHub sync (FEAT-009)

## 2. User flow and screens (numbered steps; link routes/pages)
1. `projectbrain login` asks for the project token (or opens the dashboard page to copy it); stores it in the OS config dir with 0600 permissions.
2. `projectbrain index` walks the repo (respects .gitignore), parses with @brain/core, uploads metadata in batches to POST /api/index.
3. Prints a summary: files indexed, skipped, errors, N changed / M unchanged.

## 3. Acceptance criteria (mirror agent/features.json; every criterion has a kind)
| ID | Kind | Observable behavior (testable) |
|----|------|--------------------------------|
| AC-008-01 | happy | `projectbrain login` stores a project token in the user's config dir (not in the repo) |
| AC-008-02 | happy | `projectbrain index` parses the repo locally with @brain/core and uploads files, symbols and routes in batches of at most 200 files |
| AC-008-03 | attack | A test inspects every upload request body: it contains no source text from the fixture files (only paths, hashes, names, signatures) |
| AC-008-04 | attack | POST /api/index with another project's token, or a token for project A posting to project B, returns 404 and stores nothing |
| AC-008-05 | boundary | An upload over 5 MB or with more than 200 files in one batch is rejected with 413 |
| AC-008-06 | happy | Re-running index uploads only files whose hash changed and prints 'N changed, M unchanged' |

## 4. Data and permissions
Entities touched: files, symbols (upsert by project_id + path / file_id + name). Upload schema (zod): {files:[{path, hash, size, symbols:[{kind,name,signature,line}]}]} with max 200 files, max 5 MB body.
Authorization: project token -> exactly one project; the projectId in the URL must match the token's project, else 404.

## 5. Threat model
Assets (what an attacker wants): users' source code (must never leave the machine), project tokens
Actors (anonymous, user, other user, admin, compromised dependency): anonymous visitor, signed-in other user, holder of a leaked or revoked token, compromised dependency
Entry points (routes, forms, uploads, webhooks, background jobs): POST /api/index (CLI), local config file
Abuse cases -> each becomes an `attack` or `permission` criterion with an executable test:
- Source leakage: upload schema has no field that can hold file contents; a test scans request bodies for fixture source lines (AC-008-03).
- Cross-project write with a valid token for another project (AC-008-04).
- Oversized/expensive uploads: 413 above limits (AC-008-05); rate limit 60 uploads/min per token.
- Path traversal in uploaded paths ('../', absolute paths): rejected by the schema.
- Token at rest: config file permissions 0600; token never printed after login.
Security pass (generate -> critique -> revise): after the first implementation, list "what would an attacker try next?", write
attacker tests, show them failing if vulnerable, fix, repeat once.

## 6. Performance budget
See the perf criteria above (if any) and docs/architecture.md Performance budget.

## 7. CLI stdout and exit codes
stdout: one line per phase ("Logged in as project <id>", "Indexing <N> files...", "Uploaded <N> changed, <M> unchanged", "Done in <s>s"). Errors go to stderr with a single clear message (no stack traces). Exit codes: 0 success; 1 generic failure; 2 bad arguments; 3 auth failure (login missing/revoked); 4 upload rejected (413); 5 server error. No colors when `NO_COLOR` is set.

## 8. Observability and errors
Log: route/tool name, project id, duration, result. Never log tokens, secrets, OAuth tokens or source code.
Errors: one AppError shape; 404 for anything the actor may not see.

## 9. Open questions / assumptions (label each)
- [ASSUME] v1 is single-owner projects; teams come later.
