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

**Steps (GitHub website):**
1. Neon console → project "project brain" → **Connect** → turn **Connection pooling** off → copy the connection
   string (the "direct" one).
2. GitHub → repository **Settings** → **Environments** → **New environment** → name `production-db` →
   **Configure environment**.
3. Tick **Required reviewers**, add yourself, save. Under **Deployment branches and tags** choose **Selected
   branches and tags** → **Add deployment branch or tag rule** → `main`.
4. In the same environment, **Add environment secret**: name `PRODUCTION_DATABASE_URL_DIRECT`, value = the string
   from step 1.
5. Open [owner-pending/migrate/migrate-production.yml](owner-pending/migrate/migrate-production.yml) on GitHub, tap
   **Copy raw file**, then go to **Add file → Create new file**, name it `.github/workflows/migrate-production.yml`,
   paste, **Commit directly to main**.

**Check:** Actions tab → **migrate-production** → **Run workflow** (main) → approve `production-db` → the log ends
with `no new migrations to apply.` (or lists the ones it applied). Then `https://codeceipts.vercel.app/api/health`
answers 200.

**After this:** when a PR with a migration merges, approve the `production-db` run in Actions. Vercel may deploy a
minute before the migration finishes; health recovers on its own once it does.

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
