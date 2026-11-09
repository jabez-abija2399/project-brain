# Owner actions

Things only the owner can do: protected or human-owned files, releases, the production database, secrets, accounts,
marketplaces and GitHub App permissions. Claude prepares each one (ready-to-apply files are in
[owner-pending/](owner-pending/)) and keeps working on whatever doesn't depend on it. Listed in the order to do them.
Each entry says what it unblocks and how to check it worked. Most steps work on the GitHub website from a phone.

Status: **pending**, **done** (with date).

---

## 1. Apply database migrations automatically after merge — pending

**Why:** a merged migration only reaches production when someone runs it by hand. Until then the app answers
`/api/health` with 503 and every `codeceipt doctor` reports "Server reachable but not ready". This happened on
2026-11-05 with `0048_mcp_oauth`. Later phases add more migrations.

**What it unblocks:** every phase that adds a table (2a, 3a, 6 and later) reaches production without a manual step.

**Steps:**
1. Neon console → project "project brain" → **SQL Editor** on the `production` branch → create a role that can only
   change the app's tables (not the owner role the app uses):
   `CREATE ROLE migrator LOGIN PASSWORD '<a new long password>'; GRANT ALL ON SCHEMA public TO migrator;`
   then make it own the existing tables: run `REASSIGN OWNED BY neondb_owner TO migrator;` only if the app does not
   connect as `neondb_owner` (check **Connect** → role); otherwise skip `REASSIGN` and use `neondb_owner` for now.
2. Neon → **Connect** → role `migrator` → turn **Connection pooling** off → copy the direct connection string.
3. GitHub → repository **Settings** → **Environments** → **New environment** → `production-db` → **Configure**.
   Tick **Required reviewers** (add yourself) and **untick "Allow administrators to bypass configured protection
   rules"**. Under **Deployment branches and tags** choose **Selected branches and tags** → add rule `main` (no tag
   rules).
4. Same page → **Add environment secret**: `PRODUCTION_DATABASE_URL_DIRECT` = the string from step 2.
5. Open [owner-pending/migrate/migrate-production.yml](owner-pending/migrate/migrate-production.yml) on GitHub → **Copy
   raw file** → **Add file → Create new file** → name `.github/workflows/migrate-production.yml` → paste → **Commit
   directly to main**.

**Check:** Actions → **migrate-production** → **Run workflow** (main) → approve `production-db` → the log ends with
`no new migrations to apply.` (or lists what it applied). `https://codeceipts.vercel.app/api/health` answers 200.

**Every time a run waits for your approval:** this is the one place a human reads database changes before they
reach production (Claude merges PRs on green CI). Before **Approve and deploy**, open the run's commit and look at
**Files changed** under `packages/db/migrations/` and `packages/db/src/migrat*`: only `CREATE`/`ALTER`/`INSERT`
statements for this app's tables are expected. Reject anything that drops tables, uses `dblink`, `COPY ... PROGRAM`
or creates extensions you didn't ask for. Claude lists each new migration in its owner-action entry so you know what
to expect. Vercel may deploy a minute before the migration finishes; health recovers on its own.

---

## 2. Merge the GitHub Actions version bumps — pending

**Why:** Dependabot opened PRs that change workflow files (human-owned): #1 (upload-artifact 7.0.2), #2
(setup-node 7.1.0), #16 (setup-python 7.1.0), #56 (download-artifact 8.0.2).

**Steps:** for each PR on GitHub: open it → **Files changed** (only `uses:` lines with a new pinned commit) → if
checks are green, **Merge pull request**. If a PR says it is out of date, comment `@dependabot rebase` and wait.

**Check:** the PR shows **Merged**; the next `verify` run on main is green.

---

## 3. Tidy up GitHub Releases — pending

**Why:** `cli-v0.3.2` binaries crash on users' machines (fixed in 0.3.3); `cli-v0.3.0` and `cli-v0.3.1` are
leftover drafts.

**Steps:** repository → **Releases** → `cli-v0.3.2` → **Edit** → tick **Set as a pre-release** (or **Delete**) →
**Update release**. Open each draft `cli-v0.3.0` and `cli-v0.3.1` → **Delete**.

**Check:** the Releases page shows 0.3.4 as **Latest** and no drafts.

---

## 4. Lock npm publishing to the release workflow — pending (skip if already done)

**Steps:** https://www.npmjs.com/package/codeceipt/access → **Publishing access** → select **Require two-factor
authentication and disallow bypass 2fa tokens (recommended)** → **Update Package Settings**.

**Check:** reload the page; the first option is still selected. Trusted publisher shows **Valid**.

---

## 5. Faster verification: parallel CI and quick mode — pending

**Why:** CI takes 27.5 minutes as one job, and CI never ran on PRs #53 and #55 because their workflow file was invalid
YAML. Phase 1 (merged) made the tests themselves faster; these two human-owned files finish the job.

**What it unblocks:** CI in an expected 7 minutes instead of 27.5, measured on its first run (parallel jobs: guard, typecheck+lint, three test shards,
slow tests, build+e2e, scanners, audit, and one `gate` job that needs all of them); `verify.sh --quick` that runs only
the changed packages' tests, with per-step times.

**Steps (do them in this order):**
1. **Workflow first.** Open [owner-pending/verify/verify.yml](owner-pending/verify/verify.yml) on GitHub → **Copy raw
   file** → open `.github/workflows/verify.yml` → pencil (**Edit**) → select all → paste → **Commit directly to main**.
   Check: Actions shows the new jobs for that commit and `gate` turns green (about 7 minutes).
2. **Branch protection** (if you require checks): Settings → Branches → the rule for `main` → required checks:
   replace `verify` with `gate`.
3. **verify.sh second** (protected kit file). Open [owner-pending/verify/verify.sh](owner-pending/verify/verify.sh) →
   **Copy raw file** → open `scripts/verify.sh` → **Edit** → select all → paste → **Commit directly to main**.
   Expected: the `guard` job for *that one commit* fails with "scripts/verify.sh: protected guard file changed"
   (CI cannot know a human made the change). The next commit is green. From a computer you can instead commit it
   with `GUARD_ADMIN=1 git commit` and push; the CI guard still flags that one push.

**Check:** on any later PR, the checks list shows `guard`, `typecheck`, `test-core`, `test-cli`, `test-web`,
`slow-tests`, `build-and-e2e`, `scanners`, `audit`, `gate`, all green. Locally, `bash scripts/verify.sh --quick`
prints a time next to every step and a `TOTAL` line.

---

## 6. Apply migration 0051 (context-pack cache) — pending, optional

**Why:** Phase 2a caches each feature's context-pack file and component lines so `get_context_pack` is one row read.
Until 0051 is in production, packs are built live exactly as before, and `/api/health` stays 200 but lists it under
`migrations.pending` with `optional: true`.

**Steps:** if action 1 is done, approve the `migrate-production` run that follows the merge. Otherwise, Neon
**SQL Editor** on `production` → paste
[packages/db/migrations/0051_context_pack_cache.sql](../packages/db/migrations/0051_context_pack_cache.sql) → **Run**
→ then run `INSERT INTO "_brain_migrations" (id) VALUES ('0051_context_pack_cache');`.

**What to expect in the SQL (review before approving):** one `CREATE TABLE "context_pack_cache"` (paths, component
lines, counts; never source code), one `CREATE FUNCTION "context_pack_cache_clear"` (it only deletes rows of that
table), and four `CREATE TRIGGER` lines on `files`, `symbols`, `feature_files`, `features`. Nothing is dropped or
changed.

**Check:** `https://codeceipts.vercel.app/api/health` shows no `migrations` field.

---

## 7. Let `list_features` leave the tool list next release — pending, low priority (needs a computer)

**Why:** acceptance criterion AC-011-01 names `list_features` in the tool list, so it stays listed (as a one-line
"old name of where_did_we_stop with features: true"). Removing it saves about 70 tokens per session but needs the
criterion reworded, which only the owner may approve.

**Steps (on a computer, in the repo):** add `agent/plan.json` with FEAT-011's AC-011-01 check reading "An MCP client
(Claude Code) connects to /mcp and lists the tools where_did_we_stop, get_context_pack, find_similar_component,
save_progress, add_decision, create_checklist, propose_checklist_change, generate_receipt (list_features may be
absent; where_did_we_stop with features: true answers it)", then run
`SPEC_CHANGE_APPROVED=1 python3 scripts/kit.py import`. Tell Claude afterwards; it then drops the old tool.

**Check:** `python3 scripts/kit.py show FEAT-011` shows the new wording.

## 8. Release CLI 0.3.6 (fast hooks, stop gate modes) — pending

**Why:** it replaces 0.3.5, which was never released, and contains:
- **Phase 2b:** every hook starts about 5× faster (the indexer loads only for `codeceipt index`), and the start note
  has a saved fallback when the server is slow.
- **Phase 4a:** the stop gate has a gentle mode. Codex and Antigravity are also held back when work is unfinished.
  The gate respects Cursor's own loop count, and still works when the AI receipt cannot be made.

Users get all of this through the release.

**Steps (after the Phase 4a PR is merged):**
1. **Create the tag** on GitHub: **Releases** → **Draft a new release** → **Choose a tag** → type `cli-v0.3.6` →
   **Create new tag on publish**, target `main`. Creating the tag is enough; you don't need to publish the release.
   From a computer instead:
   `git checkout main && git pull && git tag cli-v0.3.6 && git push origin cli-v0.3.6`
2. **Approve the run:** Actions → the **release-cli** run → approve **release** twice (GitHub release, then npm).
3. **Tell Claude** "0.3.6 is released". It pins the website installers to it from the signed manifest
   (`apps/web/src/lib/cli-release.json`) and opens the PR.
4. **Update the plugins:** users of the Codex and Antigravity plugins update them from their marketplace to get the
   new Stop hook.

**Check:** https://www.npmjs.com/package/codeceipt shows 0.3.6 with provenance, and `codeceipt --version` prints
0.3.6 after `codeceipt update`.

---

## 9. Apply migration 0054 (Project Blueprint) — pending, optional

**Why:** Phase 3a stores the Project Blueprint (criteria, boundaries, build order, version history). Until 0054 is in
production, everything else works as before; Blueprint calls answer "being set up" and `/api/health` stays 200 with
0054 under `migrations.pending` and `optional: true`.

**Steps:** if action 1 is done, approve the `migrate-production` run that follows the merge. Otherwise, Neon
**SQL Editor** on `production` → paste
[packages/db/migrations/0054_blueprint.sql](../packages/db/migrations/0054_blueprint.sql) → **Run** → then run
`INSERT INTO "_brain_migrations" (id) VALUES ('0054_blueprint');`.

**What to expect in the SQL (review before approving):** seven `CREATE TABLE` (`blueprints`, `blueprint_versions`,
`feature_dependencies`, `feature_areas`, `criteria`, `criterion_tests`, `boundaries`), unique indexes (one on the
existing `checklist_items (project_id, id)`, which is already unique by `id`), and one function plus trigger that
refuse edits to a saved Blueprint version. Nothing is dropped or changed; no source code is stored.

**Check:** `https://codeceipts.vercel.app/api/health` no longer lists `0054_blueprint`.

---

## 10. Choose the stop gate's default mode — pending, a decision only

**Why:** the roadmap asks for "gentle (default), strict, off". The gate's existing criteria (FEAT-020, AC-020-04)
say "on" (strict: the agent is blocked) is the default. Phase 4a keeps strict as the default, because changing it
would mean rewording an accepted criterion. Users can choose for themselves today with
`codeceipt config stop-gate gentle|on|off`.

**What the modes do:**
- **gentle:** Claude Code is told what is missing, without a blocking error.
- **strict (on):** Claude Code is blocked until the work is finished or explained.
- **off:** nothing is held back.

In every mode that holds the agent back, it is held back at most twice per session.

**Steps:** reply "gentle by default" or "keep strict". For "gentle by default", Claude proposes the criterion change
through `agent/plan.json`, and you approve it with `SPEC_CHANGE_APPROVED`. Claude cannot set that variable.

**Check:** `codeceipt config stop-gate` with no setting prints the default you chose.

