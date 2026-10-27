# Review: FEAT-006 Feature map (group files, shared files, PATCH rename/move)

Reviewed: diff HEAD~1..29f1d53 via agent/review-pack.md. Ran this session:
- `pnpm vitest run packages/core/src/features/group.test.ts packages/db/src/repos/features.test.ts` → 5 passed
- `cd apps/web && pnpm vitest run "src/app/api/projects/[id]/features/features.test.ts"` → 10 passed
- Two throwaway probe tests (written to the repo, run, then deleted; no source files modified). Their output is quoted below.

## Summary
The PATCH route is solid: zod `.strict()` rejects extra keys such as `projectId`; project and feature ids come only from the URL;
`requireProjectAccess` runs before any write; `update` scopes the feature *and* every moved file to the URL project (`features.ts`
update: `files.projectId = projectId` + count check), and the composite same-project FKs back this up. Cross-project moves and renames
both return 404 and change nothing (tested). Renames and moves are atomic (tested). AC-006-01..05 are met as written for the fixture app.

The problems are in how the grouping holds up on a re-index and on real-world layouts.

## HIGH
None.

## MEDIUM

### M1. A user rename does not survive a re-index: the old feature name comes back
`packages/db/src/repos/features.ts` saveMap: it creates features by **name** (`insert ... onConflictDoNothing`), and `groupFeatures`
always emits the path-derived name. Once a user renames `reviews` → `customer reviews`, the next `saveMap` sees no feature named
`reviews`, creates a new one, and links new and shared files to it.
Probe (saveMap → rename reviews → saveMap again, same map):
```
NAMES ["auth","billing","customer reviews","reviews"]
NEW_REVIEWS 1        # the recreated "reviews" already has a link (Button.tsx, shared)
```
Scenario: the user renames a feature in the dashboard. On the next push, a duplicate `reviews` feature reappears. Any new file under
`app/reviews/` goes into it, not into `customer reviews`. The saveMap docstring says "user corrections survive a re-run". FEAT-008 will
call saveMap on every index upload, so every rename gets undone. To fix this, renamed features need a stable key (for example the
path-derived `slug`/`source_key`, kept separate from the display `name`), or a rename alias table.

### M2. Moving a shared file into one feature is undone by a re-index: the shared links come back
Same function: shared links are inserted with `onConflictDoNothing`. Only the `(feature, file)` PK for the feature the user chose
conflicts. Every other `usedBy` feature gets its shared link back.
Probe (Button.tsx shared by auth/billing/reviews → PATCH moveFiles into auth → saveMap again):
```
BUTTON [["auth","primary"],["billing","shared"],["reviews","shared"]]
```
After the move it was `[["auth","primary"]]` (the route test asserts that). The file ends up primary *and* shared, which mixes the two
roles the feature is meant to keep apart. Related: saveMap cannot tell a user's correction from an earlier automatic assignment. So a
file that was auto-placed once is never re-grouped, even when a later index makes it shared (it then gets primary + shared links too).
No test covers saveMap being called twice. The "corrections survive" promise is untested (see L3).

### M3. Grouping breaks down on common real-world layouts of the first target stack (React/Next.js + Supabase)
`packages/core/src/features/group.ts` `featureFromPath` / `featureFromAppPath`. Probe results:
- **Catch-all route groups swallow every route.** In `featureFromAppPath`, the first named route group wins.
  `src/app/(dashboard)/reviews|billing|settings/page.tsx` → a single feature `dashboard`, and `(protected)/projects` → `protected`.
  `(dashboard)`, `(protected)`, `(authenticated)` and `(main)` are very common in AI-generated Next.js apps. Only `(app)` is excluded
  (GENERIC_NAMES).
- **Vite/React (Lovable-style) apps collapse into "other".** `src/App.tsx`, `src/pages/*.tsx`, flat `src/components/Navbar.tsx` and
  `src/integrations/supabase/client.ts` → `{"features":[{"name":"other", files: all 7}], "shared":[]}`. The cause: `pages` is not
  treated as a route root, and flat files directly under `components/` are never named (the loop bound is `i < segments.length - 2`).
- **Next.js Pages Router**: `featureFromPath("src/pages/billing/index.tsx")` and `("pages/api/stripe.ts")` → `null`. Route files have
  no importers, so they all fall to `other`.

AC-006-01 says "for the fixture app", so the criterion passes. But the fixture only covers one layout, a clean App Router app with
named groups. For the product's target users the feature map would be a single bucket. Suggested direction: skip route groups that
contain other named routes (only use a group's name when nothing below it names a feature), treat `pages/` like `app/`, and add
fixtures for Vite and route-group layouts.

## LOW

### L1. Any unique violation in `update` is reported as "feature name taken"
`features.ts` update catch: `if (isUniqueViolation(err)) throw new FeatureNameTakenError()`. The transaction can also hit
`feature_files_one_primary_uniq`. Scenario (READ COMMITTED): two PATCH requests move the same file into two different features at the
same time. Both run the DELETE, and the second INSERT hits the partial unique index. The client gets `409 feature_name_taken` for a
request that never changed a name. The fix is to check the constraint name (`feature_files_one_primary_uniq` vs
`features_project_name_uniq`) or lock the file rows first. Evidence is file:line plus the scenario; PGlite runs on one connection, so
the race cannot be reproduced in tests.

### L2. An `app` folder anywhere in the path is treated as the Next.js app root
`featureFromPath`: `segments.indexOf("app")` matches any folder named `app`. Probe: `src/components/app/Header.tsx` → `home`, and
`packages/app/src/lib/x.ts` → `src` (a feature named "src"). The second case appears in monorepos that have a package called `app`.

### L3. Test gaps
- No test calls `saveMap` twice (re-index) with a rename or move in between. That would have caught M1 and M2.
- `group.test.ts` checks only the fixture layout and synthetic `components/<x>` / `features/<x>` paths. It never tests route groups
  that hold several features, `pages/`, or flat `components/`.
- `FALLBACK_FEATURE`/`ROOT_FEATURE` names (`other`, `home`) can collide with a real folder or route named `other`/`home`. The two get
  merged silently. Untested; minor.

## Checked and fine
- Ownership: 401 when signed out, 404 for another user's project, 404 for another project's feature through your own project id,
  404 when stealing another project's file id. Nothing changes in any of these cases (all tested; the queries scope every lookup by the
  URL project).
- Body: `.strict()` rejects `projectId` and other unknown keys; an empty body and a blank/whitespace name return 400; moveFiles is
  capped at 50 ids of ≤100 chars each.
- Atomicity: a failed rename rolls back the moves in the same request (tested).
- No source code is stored: only paths, feature names and roles. Layering: core stays pure, and DB access goes through repos.
- Migration 0005 is additive (default 'primary', partial unique index), and the Drizzle schema matches it.

VERDICT: FAIL
