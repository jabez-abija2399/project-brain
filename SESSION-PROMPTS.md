# Cheat sheet: what to type (start a FRESH session for each task)
The full instructions live once, in `.agents/skills/<name>/SKILL.md` (Codex, Cursor, Gemini CLI, Antigravity, Copilot,
OpenCode and others read that folder; Claude Code reads the copy in `.claude/skills/`). Claude Code: `/name args`.
Other agents: "use the <name> skill for FEAT-003", or paste the SKILL.md text.

| You want | Type | Notes |
|---|---|---|
| Plan the project (once) | `/kickoff <idea>` | 3 stops for your approval |
| Build the next feature | `/feature` or `/feature FEAT-004` | 90% of sessions |
| Fix a bug | `/bugfix <what happens vs what should>` | failing test first |
| Change your mind | `/change <what>` | writes agent/plan.json, waits for you |
| "Did you really do it?" | `/prove` | read-only |
| "Where are we?" | `/state` | read-only |
| Security pass on a feature | `/security FEAT-x` | after every security-sensitive feature |
| Performance pass | `/perf [FEAT-x]` | numbers before/after |
| Test the running app like a user | `/evaluate FEAT-x` | fresh session; strict: `KIT_ROLE=evaluator claude` |
| Independent code review | `/peer-review FEAT-x` | different model if possible |
| Before real users | `/audit` | reports only |

Let a feature run to the end without nudging (Claude Code): `/goal FEAT-004 is done in python3 scripts/kit.py status`
In OpenCode never run `/init` (it overwrites AGENTS.md).
