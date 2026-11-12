# Owner actions

Things only the owner can do: protected or human-owned files, releases, the production database, secrets, accounts,
marketplaces and GitHub App permissions. Claude prepares each one (ready-to-apply files are in
[owner-pending/](owner-pending/)) and keeps working on whatever doesn't depend on it. Listed in the order to do them.
Each entry says what it unblocks and how to check it worked. Most steps work on the GitHub website from a phone.

Status: **pending**, **done** (with date).

## Where to start (ordered 2026-11-11, after the roadmap)

Nothing below is done yet. The numbers are the entries further down; they keep their original numbers, so this is
the order to do them in, most useful first.

**First, so that what was built reaches users (about an hour in total):**
1. **Action 1**: apply database migrations automatically after merge. Do this first: it makes actions 6, 9, 11, 13
   and 16 happen by themselves on the next merge.
2. **DONE 2026-11-11.** Claude applied migrations 0051, 0054, 0055, 0056 and 0057 to `production` through the Neon
   connector at the owner's request, after copying production to the Neon branch `backup-before-0051-0057` (delete it
   in Neon → Branches once you are happy; restore from it to undo). `/api/health` answered 200 with nothing pending.
   Earlier text: **Actions 6, 9, 11, 13, 16**: apply migrations 0051, 0054, 0055, 0056 and 0057, only if you skipped action 1. Until then
   the context-pack cache, the Blueprint, approvals and the pull-request switch show "being set up" and nothing
   else breaks.
3. **Action 8**: release CLI 0.3.7. Everything in the CLI since Phase 2 waits on this: fast hooks, the done gate,
   Guard, protected paths, import and export, `status`, the claim checker, `--json`.

**Then, decisions only you can make (a few minutes each):**
4. **Action 10**: choose the done gate's default mode.
5. **Action 14**: let the GitHub App comment on pull requests (needed before the pull-request switch does anything).
6. **Action 12**: choose an email provider for approval notifications.

**When you have time (housekeeping and optional):**
7. **Action 5**: faster verification (parallel CI and quick mode).
8. **Action 2**: merge the GitHub Actions version bumps.
9. **Action 4**: lock npm publishing to the release workflow.
10. **Action 3**: tidy up GitHub Releases.
11. **Action 7**: let `list_features` leave the tool list (one release after action 8).
12. **Action 15**: try, package and publish the VS Code extension (after action 8).

**Done after your go-ahead (2026-11-11):** when a project is linked through the GitHub App, the repository list
now shows only repositories the signed-in person can access on GitHub, and only those can be linked (decision
D-032). Nothing for you to do.

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

## 6. Apply migration 0051 (context-pack cache) — DONE 2026-11-11 (by Claude, owner-approved)

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

## 8. Release CLI 0.3.10 — DONE 2026-11-12 (0.3.9 on npm is broken; was 0.3.7, then 0.3.8; fast hooks, stop gate modes, Codeceipt Guard)

**Why:** it replaces 0.3.5 and 0.3.6, which were never released, and contains:
- **Phase 2b:** every hook starts about 5× faster (the indexer loads only for `codeceipt index`), and the start note
  has a saved fallback when the server is slow.
- **Phase 4a:** the stop gate has a gentle mode. Codex and Antigravity are also held back when work is unfinished.
  The gate respects Cursor's own loop count, and still works when the AI receipt cannot be made.
- **Phase 5a:** `codeceipt guard` checks a commit (`--staged`, as a pre-commit hook offered at setup) or a branch
  (`--ci`) for weakened tests, new secrets, hidden characters and the Blueprint's boundaries.
- **Phase 5b:** edits under a protected path are stopped before they happen, through each agent's pre-tool-use hook
  (Claude Code, Cursor, Codex, Antigravity).
- **Phase 11:** `codeceipt status --json` and `codeceipt last --json` print the same answers as data, for the
  VS Code extension (action 15) and other tools.
- **Phase 10a:** receipts check what the agent said it did (tests added, tests pass, files changed or left alone)
  against the change.
- **Phase 9a:** `codeceipt status` prints the one next step, the same one the Overview page shows.
- **Phase 8b:** `codeceipt export` writes the approved Blueprint into AGENTS.md, OpenSpec or Spec Kit files, and
  `--check` fails when they are out of date.
- **Phase 8a:** `codeceipt import` turns an existing spec (the kit's features.json, Spec Kit, Kiro, OpenSpec,
  AGENTS.md, a README) into a plan draft for you to approve.
- **Phase 7a:** `codeceipt review` prints the build checklist and size flags for a change, and the plugins get the
  `/codeceipt-feature`, `/codeceipt-fix` and `/codeceipt-review` workflows.

Users get all of this through the release.

**Steps (after the Phase 5b PR is merged):**
1. **Create the tag** on GitHub: **Releases** → **Draft a new release** → **Choose a tag** → type `cli-v0.3.7` →
   **Create new tag on publish**, target `main`. Creating the tag is enough; you don't need to publish the release.
   From a computer instead:
   `git checkout main && git pull && git tag cli-v0.3.7 && git push origin cli-v0.3.7`
2. **Approve the run:** Actions → the **release-cli** run → approve **release** twice (GitHub release, then npm).
3. **Tell Claude** "0.3.7 is released". It pins the website installers to it from the signed manifest
   (`apps/web/src/lib/cli-release.json`) and opens the PR.
4. **Update the plugins:** plugin users update them from their marketplace to get the new Stop and pre-tool hooks.

**Check:** https://www.npmjs.com/package/codeceipt shows 0.3.7 with provenance, and `codeceipt --version` prints
0.3.7 after `codeceipt update`.


**2026-11-12: the first try stopped at macOS.** Run #16 cancelled `build-macos` with "The configuration
'macos-14-arm64-us-default' is not supported": GitHub retired the macOS 14 machines. Nothing was published. Fix (phone):
1. GitHub → repository → `.github/workflows/release-cli.yml` → pencil icon → line 74: change `runs-on: macos-14` to
   `runs-on: macos-15` → **Commit changes** → commit directly to `main`.
2. A re-run would use the old file, so start over: **Releases** → the `cli-v0.3.7` release → **Delete**; then
   **Tags** → `cli-v0.3.7` → **⋯** → **Delete tag**.
3. **Releases** → **Draft a new release** → tag `cli-v0.3.7` → **Create new tag on publish**, target `main` →
   **Publish release**.
4. **Actions** → **release-cli** → the new run → approve **release** twice. Tell Claude "0.3.7 is released".

**2026-11-12: released as 0.3.8 instead.** The `cli-v0.3.7` tag could not be deleted (tag rules protect release
tags), so the version moved to 0.3.8 and the `cli-v0.3.7` tag and its draft release can simply stay. Steps:
1. Make the macOS fix above (`runs-on: macos-15`, line 74 of `.github/workflows/release-cli.yml`), committed to `main`
   (done by the owner, 2026-11-12).
2. After Claude says the 0.3.8 change is merged: **Releases** → **Draft a new release** → tag `cli-v0.3.8` →
   **Create new tag on publish**, target `main` → **Publish release**.
3. **Actions** → **release-cli** → the new run → approve **release** twice. Tell Claude "0.3.8 is released".


**2026-11-12: now 0.3.9.** The `cli-v0.3.8` tag was created before the 0.3.8 change was merged, so it points at a
commit whose CLI is still 0.3.7 and the release stopped at "Tag matches the CLI version". That tag cannot be deleted
either, so the version moved to 0.3.9. **Wait until Claude says the 0.3.9 change is merged**, then: **Releases** →
**Draft a new release** → tag `cli-v0.3.9` → **Create new tag on publish**, target `main` → **Publish release** →
approve **release** twice → tell Claude "0.3.9 is released".

**2026-11-12: 0.3.9 is out but its npm package is broken; release 0.3.10.** The GitHub release and its native
binaries (the website installers) are fine. The npm package `codeceipt@0.3.9` is not: npm 11 removed its command
(`"./codeceipt.mjs"` is rejected; `npx codeceipt` fails), and the release workflow hands only 4 files to the npm job,
leaving out `chunks/` (index, guard, menu and others). Code fix is in the 0.3.10 PR. Your part:
1. GitHub → `.github/workflows/release-cli.yml` → pencil → in the `build-npm` job, step "Hand the package to
   publish-npm", the `path:` list ends with `packages/cli/dist/child.mjs`. Add one line under it, same indent:
   `            packages/cli/dist/chunks/` → **Commit directly to main**.
2. After Claude says the 0.3.10 change is merged: **Releases** → **Draft a new release** → tag `cli-v0.3.10`, target
   `main` → **Publish release** → approve **release** twice → tell Claude "0.3.10 is released".
3. Optional, from a computer with npm login: `npm deprecate codeceipt@0.3.9 "broken package, use 0.3.10"`.
---

## 9. Apply migration 0054 (Project Blueprint) — DONE 2026-11-11 (by Claude, owner-approved)

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

## 10. Choose the stop gate's default mode — DONE 2026-11-11: owner chose "keep strict" (no change needed)

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


---

## 11. Apply migration 0055 (approval policies) — DONE 2026-11-11 (by Claude, owner-approved)

**Why:** Phase 6a stores each project's approval policy, the requests agents make and an append-only audit log. Until
0055 is in production, everything else works as before: approval calls answer "being set up", and `/api/health`
stays 200, with 0055 listed under `migrations.pending` and `optional: true`.

**Steps:**
- If action 1 is done, approve the `migrate-production` run that follows the merge.
- Otherwise:
  1. In the Neon **SQL Editor**, on `production`, paste
     [packages/db/migrations/0055_approvals.sql](../packages/db/migrations/0055_approvals.sql) and click **Run**.
  2. Then run `INSERT INTO "_brain_migrations" (id) VALUES ('0055_approvals');`.

**What to expect in the SQL (review before approving):**
- Three `CREATE TABLE`: `approval_policies`, `approval_requests` and `approval_audit`.
- Two indexes.
- One function and trigger that refuse any edit or delete of an audit row (except when its project is deleted).
- Nothing is dropped or changed.

**Check:** `https://codeceipts.vercel.app/api/health` no longer lists `0055_approvals`.

---

## 12. Choose an email provider for approval notifications — owner chose Resend 2026-11-12; waiting for the key in Vercel

**Why:** Phase 6 asks for email (and browser) notifications when an agent asks for something. Codeceipt has no email
provider yet, and adding one needs an account and a secret, which only you can create. Until then:
- the Approvals tab shows what is waiting;
- `codeceipt approvals` prints its link;
- requests expire after 24 hours, and nothing happens for them.

**Steps:**
1. Pick a provider, for example Resend or Postmark.
2. Create an API key.
3. Add it in Vercel → Project → **Settings** → **Environment Variables** (e.g. `RESEND_API_KEY`), together with the
   sender address you verified.
4. Tell Claude "email provider added: <name>". Claude then adds the notification job, one batched email per hour at
   most, with links to approve, and the variable names in `.env.example`.

**Check:** an agent's request that needs your approval sends you one email with a link to the Approvals tab.


**Built (2026-11-11, switched to Resend 2026-11-12):** the hourly approval email is in the app and switched off until
both variables exist.
1. resend.com → sign up → **Domains** → **Add Domain** → add the DNS records it shows at your domain provider and wait
   for "Verified". (Without your own domain, Resend only sends test emails to your own address from
   `onboarding@resend.dev`.)
2. **API Keys** → **Create API Key** (permission: Sending access) → copy it once.
3. Vercel → project → **Settings** → **Environment Variables** (Production): `RESEND_API_KEY` = the key,
   `RESEND_FROM` = e.g. `Codeceipt <alerts@yourdomain.com>` → **Save** → **Deployments** → latest → **Redeploy**.

What it sends: at most one email an hour per owner, only when an agent asked for an approval in the last full hour:
counts per project and a link to its Approvals tab. The agent's own words are never in the email.
---

## 13. Apply migration 0056 (project settings) — DONE 2026-11-11 (by Claude, owner-approved)

**Why:** Phase 10b stores one switch per project: receipts on pull requests, off by default. Until 0056 is in
production the switch reads as off and cannot be turned on; everything else works as before, and `/api/health` stays
200, with 0056 listed under `migrations.pending` and `optional: true`.

**Steps:**
- If action 1 is done, approve the `migrate-production` run that follows the merge.
- Otherwise:
  1. In the Neon **SQL Editor**, on `production`, paste
     [packages/db/migrations/0056_project_settings.sql](../packages/db/migrations/0056_project_settings.sql) and click
     **Run**.
  2. Then run `INSERT INTO "_brain_migrations" (id) VALUES ('0056_project_settings');`.

**What to expect in the SQL (review before approving):**
- One `CREATE TABLE`: `project_settings` (project id, the switch, who changed it and when).
- Nothing is dropped or changed.

**Check:** `https://codeceipts.vercel.app/api/health` no longer lists `0056_project_settings`.

---

## 14. Let the GitHub App comment on pull requests — DONE 2026-11-12 (Contents read, Pull requests + Checks read/write, Push + Pull request events)

**Why:** Phase 10b can post a project's receipts as one comment on each pull request, with a check run that never
blocks a merge. The Codeceipt GitHub App today can only read code and hears only about pushes. Until you do this,
turning the switch on does nothing: GitHub sends no pull request events, and the code posts nothing.

**What changes for people who installed the App:** GitHub asks each of them to accept the new permissions. Until
they accept, their installation keeps working as before, without pull request comments.

**Steps (GitHub website, on your phone or computer):**
1. Open **GitHub → Settings → Developer settings → GitHub Apps → Codeceipt → Permissions & events**.
2. Under **Repository permissions** set:
   - **Pull requests: Read and write** (to add and update the comment; in GitHub, comments on a pull request need
     this or Issues);
   - **Checks: Read and write** (for the check run).
3. Under **Subscribe to events** tick **Pull request**.
4. Click **Save changes**. GitHub emails each account that installed the App to accept.
5. Accept it for your own installation: **Settings → Applications → Installed GitHub Apps → Codeceipt → Review
   request**.
6. Do action 13 first if you have not (the switch needs it).

**Check:** on a project's **Connect** tab turn on "Receipts on pull requests", open a pull request in that
repository, and within a minute one comment titled "Codeceipt receipt" appears; a new push updates the same comment.

**To undo:** turn the switch off on the Connect tab (nothing more is posted), or set the two permissions back to
**No access**.

---

## 15. Try, package and publish the VS Code extension — pending, optional

**Why:** Phase 11 built a small editor extension (`packages/vscode-extension`, see
[vscode-extension.md](vscode-extension.md)) that shows the last receipt and the next step. It is tested, but nobody
can install it until it is packaged, and publishing needs a marketplace account, which only you can create. Do
action 8 first: the extension needs CLI 0.3.7.

**A. Try it (computer, 5 minutes):**
1. In a terminal in the repository: `pnpm install`, then `pnpm --filter codeceipt-vscode build`.
2. Open the folder `packages/vscode-extension` in VS Code and press **F5**. A second window opens.
3. In that window open a folder you connected with `npx codeceipt`.
4. Check: the status bar (bottom left) says "Codeceipt: ..."; the Explorer has a "Codeceipt" section with the next
   step and the last receipt; **Ctrl/Cmd+Shift+P → "Codeceipt: Open receipts in the browser"** opens the Receipts
   page.
5. Open a folder and choose "No, I don't trust the authors": the extension must show nothing.

**B. Package it (computer):**
1. In `packages/vscode-extension/package.json` remove the line `"private": true,` (the packaging tool refuses
   private packages) and add an icon if you want one.
2. Run `npx @vscode/vsce package --no-dependencies` in `packages/vscode-extension`. It writes
   `codeceipt-vscode-0.1.0.vsix`. (`@vscode/vsce` is Microsoft's packaging tool; it is run once here, not added to
   the project.)
3. Anyone can now install the file: **Extensions → ... → Install from VSIX**.

**C. Publish it (optional):**
1. VS Code Marketplace: create a publisher named `codeceipt` at `https://marketplace.visualstudio.com/manage`
   (needs a Microsoft account), then upload the `.vsix` there.
2. Open VSX (used by Cursor, Windsurf and Antigravity): sign in at `https://open-vsx.org` with GitHub, create the
   `codeceipt` namespace, and upload the same `.vsix`.
3. Tell me the two links and I will add them to the quickstart and the landing page.

**Not done by me, on purpose:** an automated test that starts a real VS Code (`@vscode/test-electron`). It downloads
a full editor and needs a display; CI has neither. If you want it, say so and I will add it with a CI job proposal in
`docs/owner-pending/`.

**To undo:** unpublish the extension on each marketplace page; users uninstall it from the Extensions view.

---

## 16. Apply migration 0057 (user preferences) — DONE 2026-11-11 (by Claude, owner-approved)

**Why:** the "How do you build?" answer on the Get started page is kept per account, so it follows you to every
browser and phone. Until 0057 is in production it is kept in one browser only (as before); `/api/health` stays 200,
with 0057 listed under `migrations.pending` and `optional: true`.

**Steps (phone works):**
- If action 1 is done, approve the `migrate-production` run that follows the merge.
- Otherwise:
  1. In the Neon **SQL Editor**, on `production`, paste
     [packages/db/migrations/0057_user_preferences.sql](../packages/db/migrations/0057_user_preferences.sql) and click
     **Run**.
  2. Then run `INSERT INTO "_brain_migrations" (id) VALUES ('0057_user_preferences');`.

**What to expect in the SQL (review before approving):**
- One `CREATE TABLE`: `user_preferences` (your account id, the answer, when it changed).
- Nothing is dropped or changed.

**Check:** `https://codeceipts.vercel.app/api/health` no longer lists `0057_user_preferences`.


## 17. Release CLI 0.3.11 (Claude Code on the web) — pending

**Why:** 0.3.11 lets hooks in Claude Code on the web use a key from the cloud environment (docs/cloud-sessions.md).
Until it is released, cloud sessions stay silent (pushes and pull requests still get receipts through GitHub).

**Steps (phone works):** GitHub → Releases → **Draft a new release** → **Choose a tag** → type `cli-v0.3.11` →
**Create new tag on publish**, target `main` → **Publish release**. Then Actions → **release-cli** → approve the
waiting jobs (twice). Tell Claude "0.3.11 is released"; Claude pins the website installers.

**Then, to try it:** follow docs/cloud-sessions.md for one repository (token, two environment variables, network).
