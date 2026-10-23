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
# Export root .env (and .env.local if present) so child processes see DATABASE_URL etc.
# Next.js only auto-loads .env from apps/web, so without this the root .env is ignored.
# We parse with Node (scripts/load-env.mjs) because `. ./.env` breaks on unquoted
# values containing shell metacharacters like '&' (common in Neon connection strings).
eval "$(node scripts/load-env.mjs .env .env.local)"
# Diagnostic: no values printed. If DATABASE_URL length is 0, your .env line is blank, commented out, or quoted strangely.
echo "[dev] .env loaded. DATABASE_URL length: ${#DATABASE_URL}  BETTER_AUTH_SECRET length: ${#BETTER_AUTH_SECRET}"
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[dev] DATABASE_URL is empty after sourcing .env." >&2
  echo "[dev] Check that .env has an uncommented line of the form: DATABASE_URL=postgres://...  (no spaces around '=')." >&2
fi
pnpm --filter @brain/db migrate
pnpm --filter @brain/web dev
