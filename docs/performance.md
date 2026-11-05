# Verification performance

Measured numbers first, then the changes. Targets (owner, 2026-11-05): quick check under 1 minute for a typical
one-package change; full local check at least 3 times faster than the baseline; CI under 8 minutes.

## Baseline (measured)

| What | Time | How measured |
|---|---|---|
| CI `verify` job, full gate | about 26 min (07:34 to 08:00 UTC, 2026-11-05, run 41988234521) | GitHub check-run timestamps |
| `packages/db` tests, local | 118 s (82 tests, 20 files) | wall clock, `npx vitest run` |

Not yet measured: the full local `scripts/verify.sh` per step, and the other packages. `verify.sh` does not print step
durations yet (it is human-owned; see the proposed change below).

## Done

- **Migrated test image** (`packages/db/src/testing.ts`): migrations run once per process to build an image; each
  `createTestDb()` loads a fresh PGlite from that image. Isolation is kept (every test still gets its own database).
  `packages/db` tests: 118 s to 93 s, all 82 still pass.

## Decided

- **No Turborepo.** `pnpm` filters (`--filter "...[origin/main]"`) and TypeScript incremental builds cover the
  changed-only and cache goals without a new package. Recorded in `docs/decisions.md`.

## Not done yet (needs the owner)

- `scripts/verify.sh` (protected): print per-step and per-package durations; add a `--quick` mode that runs typecheck,
  lint and tests only for packages changed since `origin/main` and their dependents, and skips tests for docs-only changes.
- `.github/workflows/verify.yml` (human-owned): split into parallel jobs (typecheck and lint; test shards per package
  group; build and e2e; security scanners), with dependency caching between runs.
- Mark the slow sandbox and end-to-end tests so `--quick` skips them unless their package changed.

## Measured after the changes (local, 4 cores, 2026-11-05)

| What | Before | After | Notes |
|---|---|---|---|
| `apps/web` test suite (93 files, 794 tests) | 18 min 08 s | 12 min 17 s (template) and 6 min 55 s (template + parallel files) | Every test database starts from the migrated image; web test files run in up to 4 workers. All 794 pass in each run. |
| `packages/db` tests (82 tests) | 118 s | 93 s (template) | Same template change. |
| `--quick` for a `packages/db`-only change | 811 s (dependents' tests included) | 98.8 s | Typecheck and lint for the changed package and its dependents; tests only for the changed package. Measured on a branch whose only change against `origin/main` is the database template. |

Not measured yet: the full local `scripts/verify.sh`, and the new parallel CI workflow (its first run is on the PR that adds it). The CI baseline is the single-job run of about 26 minutes.

## Decisions

- **Quick mode** runs tests only for packages whose own files changed. Dependents get typecheck and lint, and their tests run in the full gate and in CI. Reason: the web app imports `@brain/db` almost everywhere, so related-test selection still ran most of the web suite (713 s).
- **No Turborepo** for now: `pnpm` filters plus the migrated database image and parallel workers meet the targets.
