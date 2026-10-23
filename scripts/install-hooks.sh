#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
chmod +x .githooks/pre-commit scripts/*.sh scripts/kit.py .claude/hooks/*.py 2>/dev/null || true
git config core.hooksPath .githooks
# generated, local-only kit files (each line added once; safe to re-run after a kit upgrade)
for l in agent/.symbols-cache.json agent/.verify/ agent/last-verify.log agent/last-verify.txt agent/review-pack.md; do
  grep -qxF "$l" .gitignore 2>/dev/null || { grep -qF '# AI build kit' .gitignore 2>/dev/null || printf '\n# AI build kit (generated, local)\n' >> .gitignore; echo "$l" >> .gitignore; }
done
echo "Git hooks installed (core.hooksPath=.githooks). .gitignore updated."
