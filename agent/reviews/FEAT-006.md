# Review: FEAT-006 Feature map (re-review: re-index of renames/moves, layouts, one more Lovable/Bolt layout)

Reviewed at HEAD c732bd0 (the review-pack diff is an unrelated code-index refactor, so this review reads the current FEAT-006 code
directly: `packages/core/src/features/group.ts`, `packages/db/src/repos/features.ts`, migration 0006, and the tests).
Ran this session:
- `pnpm vitest run packages/core/src/features/group.test.ts packages/db/src/repos/features.test.ts` → 12 passed
- `cd apps/web && pnpm vitest run "src/app/api/projects/[id]/features/features.test.ts"` → 13 passed
- Two throwaway probe tests. Each was written, run, and deleted; no source files were changed. Their output is quoted below.

## Previous findings: re-run

| Previous | Status | Evidence (probe output, this session) |
|---|---|---|
| M1 a rename is undone by a re-index | FIXED | saveMap → rename reviews → saveMap with the same map: `[["@home","home"],["auth","auth"],["billing","billing"],["login","login"],["reviews","customer reviews"]]`. There is no second `reviews`. Features now match on `features.key` (migration 0006, `features.ts` saveMap). |
| M2 a moved shared file gets its shared links back | FIXED | Move Button.tsx into auth → saveMap: `[["auth","primary"]]`. `placedBy: "user"` links are filtered out of the re-insert. |
| (extra) rename onto an old name, rename the feature that holds a user-placed file, re-index twice | OK | billing renamed to `reviews`, auth to `login & signup`: names stay, ids stay, `Button → login & signup (primary)`, `stripe.ts → (billing key, shown as "reviews") primary`. |
| M3 route groups swallow every route | FIXED | `src/app/(dashboard)/reviews/page.tsx → reviews`, `(protected)/projects → projects` |
| M3 Pages Router returns null | FIXED | `src/pages/billing/index.tsx → billing`, `pages/api/stripe.ts → stripe` |
| M3 Lovable Vite app falls into "other" | FIXED | vite-app fixture test (AC-006-07) |
| L2 any `app` folder is the app root | FIXED | `src/components/app/Header.tsx → null`, `packages/app/src/lib/x.ts → null` |
| L1 any unique violation is reported as "name taken" | STILL OPEN | `features.ts` update catch still maps every 23505 to `FeatureNameTakenError`; see L1 below |
| L3 test gaps (saveMap twice, other layouts, home/other collisions) | FIXED | AC-006-06 route tests, AC-006-07 fixture tests, and the `@` key prefix test |

AC-006-01..07 are met as written, and each has a test that I ran.

## HIGH
None.

## MEDIUM

### M1. A Bolt-style Vite app (flat `src/components/`, no `pages/`) collapses into one "home" feature, and the user cannot split it
`group.ts` `featureFromPath`: it only names a feature for files under `app/`/`pages/`, for `src/main|App`, or for a sub-folder of a
container dir (the loop bound `i < segments.length - 2` deliberately skips flat files such as `components/Navbar.tsx`). A common
bolt.new layout has none of these. `App.tsx` switches between screens itself (state or `<Route>` elements), and every screen is a
flat file in `src/components/`. As a result, every file is reached only through `App.tsx`, so everything joins `@home`.
Probe (App → Auth, Dashboard; Dashboard → ReviewList, BillingPanel, Header; ReviewList → ReviewCard; several → lib/supabase):
```
BOLT {"features":[{"key":"@home","name":"home","files":["src/App.tsx","src/components/Auth.tsx","src/components/BillingPanel.tsx",
  "src/components/Dashboard.tsx","src/components/Header.tsx","src/components/ReviewCard.tsx","src/components/ReviewList.tsx",
  "src/contexts/AuthContext.tsx","src/lib/supabase.ts","src/main.tsx"]},{"key":"@other","name":"other","files":["src/types/index.ts"]}],"shared":[]}
```
There is also no way for the user to correct this. The only feature endpoint is `PATCH /api/projects/:id/features/:fid` (rename or
move *into an existing* feature). No endpoint creates a feature, so the user cannot split the single `home` bucket into auth, reviews and billing.
KI-019 records the root cause (React Router `<Route path>` strings are not read), but its workaround says "Move the file in the
dashboard", and with one feature there is nowhere to move it. The project's first audience is vibe coders on Lovable/Bolt, so for
this layout the feature map has no value. Suggested direction (pick one): when a project has no route files, name flat files in
`components/` that `App.tsx`/a router imports directly (Auth, Dashboard, ReviewList…) as features; or index `<Route path element>`
pairs (KI-019); and/or add a "create feature" endpoint so the manual workaround works. Add a `bolt-app` fixture.

### M2. A shared URL prefix such as `/dashboard/*` puts every page into one feature
`featureFromAppPath` and `featureFromPagesPath` return the **first** non-generic segment. Route groups `(dashboard)` were fixed
(previous M3), but the same layout written as a real URL segment still collapses. That layout is the usual one for SaaS apps built
with Lovable, and for Next.js SaaS starters.
```
NEXT_DASH      {"features":[{"key":"dashboard","name":"dashboard","files":["src/app/dashboard/billing/page.tsx",
                 "src/app/dashboard/page.tsx","src/app/dashboard/reviews/page.tsx","src/app/dashboard/settings/page.tsx"]}],"shared":[]}
LOVABLE_NESTED {"features":[{"key":"auth",...},{"key":"dashboard","name":"dashboard","files":["src/pages/dashboard/Billing.tsx",
                 "src/pages/dashboard/Reviews.tsx","src/pages/dashboard/Settings.tsx"]},{"key":"@home",...}],"shared":[]}
```
Scenario: a Lovable app with `/dashboard/reviews`, `/dashboard/billing` and `/dashboard/settings` gets a single `dashboard`
feature, and every component those pages import follows it. As in M1, the user cannot split it (there is no create endpoint).
Suggested direction: as the previous review proposed for groups, use a segment's name only when nothing below it names a feature.
`dashboard/page.tsx` stays `dashboard`, and `dashboard/billing/*` becomes `billing`. Add `/dashboard/*` to the route-groups or vite fixture.

## LOW

### L1. (carried over) Any unique violation in `update` is reported as "feature name taken"
`packages/db/src/repos/features.ts` update catch: `if (isUniqueViolation(err)) throw new FeatureNameTakenError()`. Two concurrent
PATCH moves of the same file into different features can both pass the DELETE. The second INSERT then hits
`feature_files_one_primary_uniq`, and the client gets `409 feature_name_taken` for a request that never changed a name.
Evidence: file:line plus this scenario (PGlite runs on one connection, so the race cannot be reproduced in tests).

### L2. Expo Router (Bolt mobile) and TanStack Router file routes are not read as routes
```
EXPO     app/(tabs)/reviews.tsx, app/(tabs)/billing.tsx, app/(auth)/login.tsx → all in @home (only app/review/[id].tsx → review)
TANSTACK src/routes/{__root,index,reviews,billing}.tsx → all in @other
```
`featureFromAppPath` drops the last segment (`afterApp.slice(0, -1)`), which is right for Next's `page.tsx` but wrong for
Expo's `reviews.tsx`. `routes/` is not a route root. Neither layout is in the first target stack (React/Next.js + Supabase), so this is LOW.
It belongs next to KI-019.

### L3. A new folder whose name matches a name the user chose gets a `-2` name
Rename `reviews` → `customer reviews`. A later index adds `src/components/customer-reviews/X.tsx`, and that creates a separate
feature named `customer reviews-2` (probe: `["customer-reviews","customer reviews-2"]`). That is correct per AC-006-05 (unique names),
but the user probably meant that folder to be part of their renamed feature. This is cosmetic, and the user can move the file
(kept on re-index).

### L4. Stale note in agent/later.md
Line 56 says "a re-index may re-create a feature under its old route name". After migration 0006 that no longer happens (see the
re-run table). The note will mislead whoever wires saveMap into the index upload. That wiring has not happened yet: `saveMap` and
`groupFeatures` have no caller outside tests (`rg -n "saveMap|groupFeatures"`), so AC-006-06 is proven at the repository level only.

## Checked and fine
- Re-index matching: by `features.key` (partial unique index `features_project_key_uniq`). User-created features have key NULL and
  are never matched. Automatic keys carry an `@` prefix, so they never merge with a folder named `home`/`other`.
- Automatic vs user links: `placed_by` with a CHECK constraint. saveMap deletes only `auto` links of the files in the new map and
  never touches `user` links. A file that moves from 2 features to 3 leaves no stale primary (tested in the AC-006-06 route test).
- Authorization and validation for PATCH are unchanged from the previous review (401, 404 cross-project for feature and file ids,
  `.strict()` body, capped moveFiles). The route tests still pass.
- No source code is stored: keys, names, paths and roles only. Core stays pure, and DB access goes through repos.

VERDICT: FAIL
