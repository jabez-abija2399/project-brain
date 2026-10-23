# Project Brain: kickoff already prepared
The kickoff (stages 1-3) has been done for you. Filled in:
AGENTS.md (PROJECT block) · docs/product.md · docs/architecture.md · docs/decisions.md (D-001..D-006) ·
docs/boundaries.txt · docs/DESIGN.md · docs/dependencies.md (all picks dep-checked 2026-10-23) ·
docs/specs/FEAT-003, 008, 009, 011, 015 (threat models) · .env.example · scripts/dev.sh ·
agent/directives.md · agent/later.md (every P2/P3 idea) · agent/plan.json (19 features, 112 criteria; NOT imported yet).

## Steps (you run these, ~5 minutes)
```bash
mkdir project-brain && cd project-brain
cp -r /path/to/ai-build-kit/. .
python3 scripts/kit.py init --name "Project Brain" --stack pnpm-monorepo --mode fast
git add -A && git commit -m "chore: add AI build kit"
```
Review the plan (recommended: open Claude Code and say "Review agent/plan.json and docs/ against the kickoff rules;
list problems only, change nothing"). Then approve it:
```bash
python3 scripts/kit.py import
python3 scripts/kit.py status
git add -A && GUARD_ADMIN=1 git commit -m "chore: kickoff plan"
```
Build: open a FRESH Claude Code session per feature and type `/feature` (starts with FEAT-001).
After FEAT-001 creates package.json: `python3 scripts/kit.py harden` and commit with GUARD_ADMIN=1.

## Accounts you will need (when the feature asks)
GitHub OAuth app (FEAT-003) · Anthropic API key (FEAT-007) · GitHub App (FEAT-009) · Neon production project, Vercel, Inngest (first deploy).
No Docker needed: create a free Neon project (neon.com), add a `dev` branch, copy its connection string into DATABASE_URL in .env.
Tests run on PGlite, an in-process Postgres, so they need no database at all.

Rename the product later: replace "Project Brain" / `projectbrain` / `@brain/*` in AGENTS.md and docs/ before FEAT-001.
