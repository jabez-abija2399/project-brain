# Product: Project Brain
Written during the kickoff. Labels: [USER] user requirement · [TECH] technical requirement · [ASSUME] assumption ·
[OPEN] open question (each [OPEN] has a recommended default so the human can answer "approve defaults").

## Purpose
- [USER] Vibe coders can build software with AI agents but cannot verify or maintain it. Project Brain gives every
  AI-built app a living blueprint (features, files, components, decisions, progress) that agents read before acting
  and update after, and gives every change a plain-language receipt: what was asked, what was done, what was missed,
  what was touched outside the feature, and which checks passed.
- Why pick it over the alternative: platforms (Lovable, Cursor, ...) only remember inside their own walls; the Brain
  is portable across agents, and the receipt gives non-engineers proof instead of promises.
- Users: solo builders and small agencies building React/Next.js + Supabase apps with Claude Code or Cursor
  (v1), and later with Lovable, Bolt and Replit through GitHub sync.

## Core flows (the whole first version; numbered, each one testable end to end)
1. Sign in with GitHub, create a project, connect a repository.
2. Run `npx projectbrain init` in the repo: the CLI detects Claude Code / Cursor, indexes the code locally, uploads the
   index (never the source), and installs the Skill, AGENTS.md section, MCP config and hooks.
3. Open a new agent session: the agent calls `where_did_we_stop` and gets the handoff note, then `get_context_pack`
   for the feature it works on, and `find_similar_component` before creating UI.
4. The user makes a request: it is captured and split into a checklist on the affected feature (living spec).
5. When the agent finishes (or a commit is pushed), a receipt is generated: done / partly / missed per checklist item,
   files changed by feature, out-of-scope edits, package, secret and RLS checks.
6. The user opens the dashboard to see features with status and the receipts feed.
7. Planning (once per project): the agent calls `plan_project`, the user answers up to 8 questions (or approves the
   defaults), reviews the drafted features and checklists in the dashboard and approves them; agents then build in order.

## Requirements (each maps to features in agent/features.json; `kit.py check` fails on an unmapped requirement)
| ID | Label | Requirement |
|----|-------|-------------|
| REQ-001 | [USER] | Users sign in with GitHub and only ever see and change their own projects |
| REQ-002 | [USER] | A TypeScript/React/Next.js repo is indexed into files, components, exports, imports, routes and Supabase tables with RLS policies |
| REQ-003 | [USER] | Files are grouped into named features that the user can rename and correct |
| REQ-004 | [USER] | Agents can look up existing components by name, props and purpose before creating new ones |
| REQ-005 | [USER] | Code can be indexed on the user's machine so source code never leaves it |
| REQ-006 | [USER] | The Brain stays current: every push to the connected repo re-indexes the changed files |
| REQ-007 | [USER] | A new agent session starts with a handoff note: goal, last step, unfinished work, decisions, next step |
| REQ-008 | [USER] | Agents reach the Brain through one authenticated remote MCP server |
| REQ-009 | [USER] | Each user request becomes a checklist of testable items stored on its feature (living spec) |
| REQ-010 | [USER] | Each change gets a receipt: done/partly/missed per item, files by feature, out-of-scope edits, checks |
| REQ-011 | [USER] | New packages are verified (exists, age, repository link) before agents install them |
| REQ-012 | [USER] | Receipts flag exposed secrets in client code and Supabase tables without RLS or with allow-all policies |
| REQ-013 | [USER] | One command sets up Claude Code and Cursor (Skill, AGENTS.md section, MCP config, hooks) |
| REQ-014 | [USER] | A dashboard shows projects, features with status, and the receipts feed |
| REQ-015 | [TECH] | Source code is never stored permanently on our side; only index metadata and short summaries |
| REQ-016 | [USER] | Users' standing preferences are remembered and given to every new agent session |
| REQ-017 | [USER] | Receipts say honestly what was not verified and flag weakened or deleted tests |
| REQ-018 | [USER] | Users can plan a new or existing project once: questions with defaults, then features with testable checklists in build order, approved by the user before agents build |

## Scope
In: agent/features.json. Nothing else.
Out (parked in agent/later.md): web-builder integrations beyond MCP + GitHub (Lovable/Bolt/Replit rule export),
Codex/Gemini hooks, test generation, access-control tester, design system engine, performance checks, semantic
(embedding) search, teams, billing, cross-project learning, other languages/stacks.

## Roles and permissions
| Action | Project owner | Anyone else (signed in) | Anonymous |
|---|---|---|---|
| View project, features, receipts | yes | no (404) | no (401) |
| Rename/regroup features, edit decisions | yes | no | no |
| Upload an index / call MCP tools | yes, with a project token | no | no |
| Install GitHub App on a repo | yes (GitHub permission required) | no | no |

## Business rules (never violated; each one becomes a criterion or a project rule in AGENTS.md)
- [USER] Projects are private: a user can never read or write another user's project, by URL, API or MCP.
- [TECH] No user source code is persisted: only paths, symbols, signatures, hashes and summaries up to 200 chars.
- [USER] Detected secrets are masked everywhere (first 4 characters + ***).
- [USER] Missed checklist items are never silently dropped: they stay open until done or dismissed by the user.
- [TECH] MCP read tools answer from the database only (no LLM call), so agents are never slowed down.
- [USER] Agents may not reword or delete checklist items; only the user can change what "done" means.
- [USER] Agents can draft a plan but never approve it; only the project owner approves.
- [USER] Nothing is reported as done without evidence; unverifiable items are listed as "Not verified".

## Assumptions and open questions
- [ASSUME] v1 users build with Claude Code or Cursor on TypeScript + React/Next.js + Supabase.
- [ASSUME] Users are comfortable connecting GitHub.
- [OPEN] Product name. Default: "Project Brain" (working name), CLI command `projectbrain`.
- [DECIDED D-009] Receipt checklist judging uses the smallest Claude model, max 1 call per receipt.
- [OPEN] Pricing in v1. Default: free during the trial; billing comes after the YC application.

## Success criteria (numbers)
- A new user goes from sign-in to first receipt in under 10 minutes.
- First index of a 500-file repo finishes in under 60 s; an incremental re-index of 10 changed files in under 10 s.
- MCP read tools: p95 under 500 ms.
- Receipts catch at least 1 real missed item or out-of-scope edit per 10 receipts in dogfooding.
- 50 weekly active projects before the YC application.
