# AI Build Kit 4.1: build any project with AI coding agents, fast and without losing control
Copy this folder into a new or existing project, plan once, then build one feature per agent session. The kit keeps the
agent honest (nothing is "done" without proof), cheap (short always-on context, workflows load only when used) and on
track (every new chat starts from a brief of exactly where you stopped).

Works with Claude Code, Codex, Cursor, Gemini CLI, Antigravity, GitHub Copilot, OpenCode (all read AGENTS.md and the
shared skills folder). Needs: git, bash, python3 3.8+. Recommended: ripgrep (`rg`). Windows: Git Bash or WSL.

## 1. New project (2 minutes)
```bash
mkdir my-app && cd my-app
cp -r /path/to/ai-build-kit/. .            # the dot copies hidden folders too (.claude, .agents, .github, ...)
python3 scripts/kit.py init                # name, stack preset (auto is fine), mode fast/strict -> git, hooks, skills
git add -A && git commit -m "chore: add AI build kit"
python3 scripts/kit.py hooks               # Codex users: shows the one-time guard setup for your machine
```
Existing project: same steps inside your repo, then start the kickoff with "EXISTING CODEBASE".
Older kit in a project: `python3 scripts/kit.py upgrade /path/to/ai-build-kit` (see Upgrading).

## 2. Plan once: `/kickoff <your idea>` (or paste KICKOFF-PROMPT.md)
Three stops for your approval: questions with defaults -> architecture, packages (each compared with 2 alternatives),
import boundaries, design + component inventory -> feature plan with testable criteria. Then you run:
```bash
python3 scripts/kit.py config --stack <preset the agent recommended>
python3 scripts/kit.py harden              # dependency cooldown; run again once FEAT-001 created the manifest
git add -A && GUARD_ADMIN=1 git commit -m "chore: kickoff plan"
```

## 3. Build: one feature per FRESH session
`/feature` builds the next one. Full list in SESSION-PROMPTS.md. A new chat always knows where you are: Claude Code
injects the brief automatically (branch, unfinished files, verify result, in-progress feature with missing criteria and
its files, next feature, your directives, last progress, open HIGH issues, security features not yet reviewed).

## What makes it fast and cheap
- AGENTS.md is ~30 lines (research: long context files cost ~20% more tokens without improving results); every
  workflow is a skill that loads only when used.
- The agent finds code with `kit.py where` (exact file:line) instead of exploring; `kit.py show` instead of reading
  the plan; verify prints only the failing lines.
- Fast mode: the local gate is typecheck + lint + tests + guards (seconds); slow steps run in CI.
- Scope discipline: only what the criteria require; ideas are parked in agent/later.md.

## What keeps quality high
| Concern | How |
|---|---|
| Real "done" | criteria pass only with a fresh PASS log naming the AC id, or written evidence; strict mode: by an evaluator |
| Tests not gamed | blocks deleted/skipped tests, removed assertions, test-config tricks, a drop in passing tests; strict: held-out acceptance tests |
| Remembering | features.json (status + files per feature), progress.md, directives.md, decisions.md; `kit.py where FEAT-x` |
| Reuse / architecture | building blocks + component inventory checked first; duplicate-code detector; import rules in docs/boundaries.txt |
| Packages | dep-check (exists, age, maintenance, license) vs 2 alternatives; unrecorded packages blocked; 3-day cooldown |
| Security | server-side authz/validation rules, threat-model specs, attack tests, /security, /audit, secret/SAST/vuln scanners in CI, .env unreadable by agents |
| UI | DESIGN.md tokens + components, all states, 375/1280 px; /evaluate tests the running app in a browser |
| Performance | perf criteria with numbers, /perf (N+1, indexes, pagination, p95, bundle), optional VERIFY_PERF budget |
| Agent stops half-way | Stop hook: no stopping with a finished-but-unrecorded feature (Claude Code); `/goal` for long runs |

## Fast or strict (`python3 scripts/kit.py config --mode ...`, commit with GUARD_ADMIN=1)
| | fast (solo, MVP) | strict (team, production, money, sensitive data) |
|---|---|---|
| Local gate | typecheck, lint, tests, guards | + build, e2e, audit, scanners, perf budget |
| Manual/UI criteria | builder writes evidence | only an evaluator session (`KIT_ROLE=evaluator`) |
| Security-sensitive features | review optional | independent review required before done |
| Duplicate code | warning | error |
| Evaluations, reviews, tests/acceptance | anyone | evaluator/reviewer sessions only |

## Human-only switches (agents are blocked from setting them)
| Situation | Use |
|---|---|
| Change a kit/guard file, verify.config, cooldown files | `GUARD_ADMIN=1 git commit ...` |
| Approve reworded criteria | `SPEC_CHANGE_APPROVED=1 python3 scripts/kit.py import` and the same on commit |
| Approve a real test change / removed tests | `KIT_ALLOW_TEST_CHANGE=1` / `KIT_ALLOW_TEST_DELETE=1` on commit |
| Start an evaluator/reviewer session (strict) | `KIT_ROLE=evaluator claude` (or your agent's command) |
`git commit --no-verify` is blocked for agents; CI runs the same guard as the backstop.

## Guard hooks per agent
Claude Code `.claude/settings.json` · Cursor `.cursor/hooks.json` · Gemini CLI `.gemini/settings.json` · Copilot CLI
`.github/hooks/kit-guard.json` · Codex: hooks only work from your home folder, so run `python3 scripts/kit.py hooks`
once per machine. Every agent also gets the pre-commit hook and CI. Check with `python3 scripts/kit.py doctor`.

## Upgrading the kit in older projects
```bash
python3 scripts/kit.py upgrade /path/to/newer-ai-build-kit --dry-run
python3 scripts/kit.py upgrade /path/to/newer-ai-build-kit
bash scripts/install-hooks.sh && python3 scripts/kit.py doctor
git add -A && GUARD_ADMIN=1 git commit -m "chore: upgrade AI build kit"
```
Replaced: kit scripts, hooks, kit skills, guides, the KIT block of AGENTS.md; removed: files from older kit versions.
Never touched: the PROJECT block of AGENTS.md, docs/*, agent/*, scripts/verify.config, scripts/dev.sh, .env.example, CI.

## Honest limits
- The guards stop common agent failures (false "done", gamed tests, scope creep, invented packages, rewritten criteria,
  secrets read). They don't judge whether code is good: /evaluate, /peer-review, /security, /perf and /audit do.
- Hooks catch common ways around them, not every possible one; the pre-commit hook and CI catch the rest.
- Roles (KIT_ROLE) separate builder and evaluator by process, not by cryptography: they protect against agent mistakes
  and shortcuts, not against a person who wants to bypass them.
