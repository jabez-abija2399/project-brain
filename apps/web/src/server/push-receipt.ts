// FEAT-023: a receipt for each push to the default branch of a repository connected through the GitHub App, so
// projects built in Lovable, Bolt or Replit (or anyone who pushes) get receipts with nothing installed. The commit
// messages are the request; the changed files come from GitHub's compare (at most 300, GitHub's own limit). File
// contents are fetched through the installation token, checked in memory (secrets, test integrity, dependencies) and
// dropped: a step returns findings, flags and package.json text only, never source code.
import {
  type FileChange,
  checkTestIntegrity,
  isTestConfig,
  isTestFile,
  maskSecretsIn,
  scanSecrets,
} from "@brain/core";
import { type BrainDb, receiptsRepo, requestsRepo } from "@brain/db";
import { MAX_PACKAGE_JSON_CHARS } from "./check-package";
import type { PushEventData } from "./inngest";
import { type GithubClient, type StepRunner, fetchText, runPushIndex } from "./push-index";
import { reserveDaily } from "./rate-limit";
import { generateReceipt } from "./receipt";

/** Push receipts per project per day (security review: bounds a runaway pusher). */
export const MAX_PUSH_RECEIPTS_PER_DAY = 200;

export const MAX_RECEIPT_PUSH_FILES = 300;
const MAX_MESSAGES = 20;
const MAX_MESSAGE = 300;
const FETCH_CONCURRENCY = 8;
const PACKAGE_JSON = /(^|\/)package\.json$/;

type PushChanges = { changed: string[]; removed: string[]; total: number; messages: string[] };

/** The push job: index the changed files (FEAT-009), then make the push's receipt (FEAT-023). */
export async function runPushJob(
  db: BrainDb,
  data: PushEventData,
  step: StepRunner,
  github: () => Promise<GithubClient>,
) {
  const result = await runPushIndex(db, data, step, github);
  // Not linked: nothing is this project's. A new branch has no base to compare with, so no receipt either.
  if ("skipped" in result && (result.skipped === "not_linked" || result.skipped === "new_branch")) {
    return result;
  }
  await runPushReceipt(db, data, step, github);
  return result;
}

export async function runPushReceipt(
  db: BrainDb,
  data: PushEventData,
  step: StepRunner,
  github: () => Promise<GithubClient>,
): Promise<{ receiptId: string | null; skipped?: "already_made" | "daily_limit" }> {
  // The same push delivered twice (or the job retried) makes one receipt.
  const existing = await step.run("push-receipt-existing", () =>
    receiptsRepo.findByCommit(db, data.projectId, data.after),
  );
  if (existing) return { receiptId: existing, skipped: "already_made" };
  const [owner, repo] = data.repo.split("/") as [string, string];
  const changes = await step.run("push-receipt-changes", async () =>
    listPush(await github(), owner, repo, data),
  );
  const checks = await step.run("push-receipt-checks", async () =>
    checkFiles(await github(), owner, repo, data, changes),
  );
  return step.run("push-receipt-make", async () => {
    // A retried step (its earlier steps replayed from their stored results) must not make a second receipt.
    const made = await receiptsRepo.findByCommit(db, data.projectId, data.after);
    if (made) return { receiptId: made, skipped: "already_made" as const };
    // A runaway pusher (a bot pushing every minute) cannot fill a project with receipts: at most this many a day.
    if (
      (await reserveDaily(
        db,
        `push-receipt:${data.projectId}`,
        MAX_PUSH_RECEIPTS_PER_DAY,
        1,
        new Date(),
      )) === 0
    ) {
      return { receiptId: null, skipped: "daily_limit" as const };
    }
    // Security review: commit messages can come from anyone with push access (a merged fork, a collaborator), so
    // they are stored as the request, as written and masked: no AI turns them into checklist items.
    let requestId: string | undefined;
    if (changes.messages.length > 0) {
      const request = await requestsRepo.insert(db, data.projectId, {
        featureId: null,
        text: changes.messages.join("\n").slice(0, 4000),
        sessionId: `push-${data.after.slice(0, 12)}`,
      });
      requestId = request.id;
    }
    const gh = await github();
    const packageJson: { path: string; before: string | null; after: string }[] = [];
    for (const path of checks.packageJsonPaths) {
      const after = await fetchText(gh, owner, repo, path, data.after);
      if (after === null || after.length > MAX_PACKAGE_JSON_CHARS) continue;
      const before = await fetchText(gh, owner, repo, path, data.before);
      packageJson.push({
        path,
        before: before && before.length <= MAX_PACKAGE_JSON_CHARS ? before : null,
        after,
      });
    }
    const receipt = await generateReceipt(
      db,
      // Per project, so one installation's pushes never use up another project's limits.
      { id: `github-push:${data.projectId}`, projectId: data.projectId },
      {
        ...(requestId ? { requestId } : {}),
        changedFiles: changes.changed,
        commitSha: data.after,
        ...(packageJson.length > 0 ? { packageJson } : {}),
        secretFindings: checks.secrets,
        ...(checks.flags.length > 0 ? { testIntegrity: { flags: checks.flags } } : {}),
      },
    );
    const receiptId = typeof receipt.receipt_id === "string" ? receipt.receipt_id : null;
    if (receiptId) {
      await receiptsRepo.mergeSummary(db, data.projectId, receiptId, {
        from_push: true,
        files_not_checked: Math.max(
          0,
          changes.total - changes.changed.length - changes.removed.length,
        ),
      });
    }
    return { receiptId };
  });
}

// The push's changed and removed files (first MAX_RECEIPT_PUSH_FILES) and its commit messages (masked, short).
async function listPush(
  gh: GithubClient,
  owner: string,
  repo: string,
  data: PushEventData,
): Promise<PushChanges> {
  const changed: string[] = [];
  const removed: string[] = [];
  const messages: string[] = [];
  let total = 0;
  for (let page = 1; page <= 4; page++) {
    const res = await gh.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
      owner,
      repo,
      basehead: `${data.before}...${data.after}`,
      per_page: 100,
      page,
    });
    const body = res.data as { files?: unknown[]; commits?: unknown[] };
    const files = (body.files ?? []) as { filename?: unknown; status?: unknown }[];
    if (page === 1) {
      for (const c of (body.commits ?? []).slice(-MAX_MESSAGES)) {
        const message = (c as { commit?: { message?: unknown } }).commit?.message;
        if (typeof message === "string" && message.trim() !== "") {
          messages.push(maskSecretsIn(message.trim()).slice(0, MAX_MESSAGE));
        }
      }
    }
    for (const f of files) {
      if (typeof f.filename !== "string") continue;
      total++;
      if (changed.length + removed.length >= MAX_RECEIPT_PUSH_FILES) continue;
      if (f.status === "removed") removed.push(f.filename);
      else changed.push(f.filename);
    }
    if (files.length < 100) break;
  }
  return { changed, removed, total, messages };
}

// Secrets in the changed files, test-integrity flags (before vs after) and package.json text. Contents are dropped.
async function checkFiles(
  gh: GithubClient,
  owner: string,
  repo: string,
  data: PushEventData,
  changes: PushChanges,
) {
  const secrets: ReturnType<typeof scanSecrets> = [];
  const testChanges: FileChange[] = [];
  // Only the paths: the make step fetches the text itself, so no file text is ever kept in a step result.
  const packageJsonPaths: string[] = [];
  const paths = changes.changed;
  for (let i = 0; i < paths.length; i += FETCH_CONCURRENCY) {
    const batch = paths.slice(i, i + FETCH_CONCURRENCY);
    const texts = await Promise.all(batch.map((p) => fetchText(gh, owner, repo, p, data.after)));
    await Promise.all(
      batch.map(async (path, j) => {
        const after = texts[j] ?? null;
        if (after === null) return;
        // Every file in a push is committed, .env files too: those are the commonest leak (security review).
        secrets.push(...scanSecrets(path, after, { scanLocalEnv: true }));
        const isTest = isTestFile(path) || isTestConfig(path);
        const isPackage = PACKAGE_JSON.test(path);
        if (isPackage && packageJsonPaths.length < 10) packageJsonPaths.push(path);
        if (!isTest) return;
        const before = await fetchText(gh, owner, repo, path, data.before);
        testChanges.push({ path, before, after });
        if (isPackage && packageJsonPaths.length < 10) packageJsonPaths.push(path);
      }),
    );
  }
  for (const path of changes.removed.filter(isTestFile)) {
    const before = await fetchText(gh, owner, repo, path, data.before);
    if (before !== null) testChanges.push({ path, before, after: null });
  }
  const flags = checkTestIntegrity(testChanges).slice(0, 50);
  return { secrets: secrets.slice(0, 200), flags, packageJsonPaths };
}
