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
import { type BrainDb, receiptsRepo } from "@brain/db";
import type { PushEventData } from "./inngest";
import { type GithubClient, type StepRunner, fetchText, runPushIndex } from "./push-index";
import { generateReceipt } from "./receipt";
import { captureRequest } from "./request-capture";

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
): Promise<{ receiptId: string | null; skipped?: "already_made" }> {
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
    let requestId: string | undefined;
    if (changes.messages.length > 0) {
      try {
        const captured = await captureRequest(db, data.projectId, {
          text: changes.messages.join("\n"),
          session_id: `push-${data.after.slice(0, 12)}`,
        });
        if (typeof captured.request_id === "string") requestId = captured.request_id;
      } catch {
        // No request (budget, empty text): the receipt is still made, as one without a request.
      }
    }
    const made = await generateReceipt(
      db,
      { id: `github-push:${data.installationId}`, projectId: data.projectId },
      {
        ...(requestId ? { requestId } : {}),
        changedFiles: changes.changed,
        commitSha: data.after,
        ...(checks.packageJson.length > 0 ? { packageJson: checks.packageJson } : {}),
        secretFindings: checks.secrets,
        ...(checks.flags.length > 0 ? { testIntegrity: { flags: checks.flags } } : {}),
      },
    );
    const receiptId = typeof made.receipt_id === "string" ? made.receipt_id : null;
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
  const packageJson: { path: string; before: string | null; after: string }[] = [];
  const paths = changes.changed;
  for (let i = 0; i < paths.length; i += FETCH_CONCURRENCY) {
    const batch = paths.slice(i, i + FETCH_CONCURRENCY);
    const texts = await Promise.all(batch.map((p) => fetchText(gh, owner, repo, p, data.after)));
    await Promise.all(
      batch.map(async (path, j) => {
        const after = texts[j] ?? null;
        if (after === null) return;
        secrets.push(...scanSecrets(path, after));
        const isTest = isTestFile(path) || isTestConfig(path);
        const isPackage = PACKAGE_JSON.test(path);
        if (!isTest && !isPackage) return;
        const before = await fetchText(gh, owner, repo, path, data.before);
        if (isTest) testChanges.push({ path, before, after });
        if (isPackage && packageJson.length < 10) packageJson.push({ path, before, after });
      }),
    );
  }
  for (const path of changes.removed.filter(isTestFile)) {
    const before = await fetchText(gh, owner, repo, path, data.before);
    if (before !== null) testChanges.push({ path, before, after: null });
  }
  const flags = checkTestIntegrity(testChanges).slice(0, 50);
  return { secrets: secrets.slice(0, 200), flags, packageJson };
}
