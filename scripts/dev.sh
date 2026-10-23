#!/usr/bin/env bash
# The ONE command that starts this project locally (agents and the evaluator use it before testing in a browser).
# Loads .env from the project root, applies migrations to DATABASE_URL (a Neon 'dev' branch), then runs the
# Next.js app on http://localhost:3000. No Docker needed.
# Background jobs: run `npx inngest-cli dev` in a second terminal.
set -e
cd "$(dirname "$0")/.."
if [ ! -f package.json ]; then
  echo "No package.json yet: FEAT-001 (walking skeleton) creates the app. Build it with /feature." >&2
  exit 1
fi
[ -f .env ] || { echo "Missing .env: cp .env.example .env and fill it in." >&2; exit 1; }
set -a
. ./.env
set +a
pnpm --filter @brain/db migrate
pnpm --filter @brain/web dev
