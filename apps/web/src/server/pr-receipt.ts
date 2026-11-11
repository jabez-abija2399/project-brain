import {
  prCommentMarker,
  prReceiptCheckSummary,
  prReceiptClean,
  prReceiptComment,
  prReceiptCounts,
  receiptView,
} from "@brain/core";
import { type BrainDb, githubRepo, receiptsRepo } from "@brain/db";
import type { PrEventData } from "./inngest";
import { prReceiptsOn } from "./project-settings";
import type { GithubClient, StepRunner } from "./push-index";
import { reserveDaily } from "./rate-limit";

// Roadmap Phase 10b: receipts on a pull request. For a pull request of a linked repository whose owner turned this
// on: the project's receipts for the pull request's commits become one comment (updated in place on every push) and
// a neutral check run. Nothing is read from the repository's files; only commit ids are listed. When the GitHub App
// lacks the permission (owner action 13), nothing is posted and the job ends quietly.

export const MAX_PR_COMMENTS_PER_DAY = 200;
const MAX_COMMITS = 250;
const MAX_RECEIPTS = 5;
const MAX_COMMENT_PAGES = 5;
export const CHECK_NAME = "Codeceipt receipt";

export type PrReceiptResult =
  | { skipped: "not_linked" | "off" | "daily_limit" | "no_permission" }
  | { receipts: number; comment: "created" | "updated"; check: boolean };

const status = (err: unknown) => (err as { status?: unknown } | null)?.status;
const denied = (err: unknown) => status(err) === 403 || status(err) === 404;

export async function runPrReceipt(
  db: BrainDb,
  data: PrEventData,
  step: StepRunner,
  github: () => Promise<GithubClient>,
  origin: string,
  // The GitHub App's own id: only a comment this App made is ever updated (null when not known).
  appId: number | null = null,
): Promise<PrReceiptResult> {
  // Checked again in the job: the project may have been unlinked or the setting turned off since the webhook.
  const allowed = await step.run("pr-receipt-allowed", async () => {
    // linkedProjects also leaves out suspended projects and owners (security review).
    const linked = await githubRepo.linkedProjects(db, data.installationId, data.repo);
    if (!linked.some((p) => p.id === data.projectId)) return "not_linked" as const;
    if (!(await prReceiptsOn(db, data.projectId))) return "off" as const;
    // A bot pushing every minute cannot make the App comment without end.
    if (
      (await reserveDaily(
        db,
        `pr-receipt:${data.projectId}`,
        MAX_PR_COMMENTS_PER_DAY,
        1,
        new Date(),
      )) === 0
    )
      return "daily_limit" as const;
    return "ok" as const;
  });
  if (allowed !== "ok") return { skipped: allowed };
  const [owner, repo] = data.repo.split("/") as [string, string];
  const at = { owner, repo };

  try {
    const shas = await step.run("pr-receipt-commits", async () => {
      const gh = await github();
      const out: string[] = [];
      for (let page = 1; out.length < MAX_COMMITS && page <= 3; page++) {
        const res = await gh.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/commits", {
          ...at,
          pull_number: data.number,
          per_page: 100,
          page,
        });
        const rows = Array.isArray(res.data) ? res.data : [];
        for (const r of rows) {
          const sha = (r as { sha?: unknown }).sha;
          if (typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha)) out.push(sha);
        }
        if (rows.length < 100) break;
      }
      return out.slice(0, MAX_COMMITS);
    });
    return await step.run("pr-receipt-post", async () => {
      const rows = await receiptsRepo.listByCommits(db, data.projectId, shas, MAX_RECEIPTS);
      const views = rows.map((r) => receiptView(r.summaryJson));
      const counts = prReceiptCounts(views);
      const gh = await github();
      // Security review: the repository's visibility is read again here. Only "private" gets item text: public,
      // internal (a whole enterprise can read it) or unknown get counts only.
      const repoInfo = await gh.request("GET /repos/{owner}/{repo}", at);
      const visibility = (repoInfo.data as { visibility?: unknown } | null)?.visibility;
      const marker = prCommentMarker(data.projectId);
      const body = prReceiptComment({
        projectId: data.projectId,
        views,
        receiptsUrl: `${origin}/projects/${encodeURIComponent(data.projectId)}/receipts`,
        publicRepo: data.publicRepo || visibility !== "private",
      });
      // Our own earlier comment for this project is updated in place: its first line is this project's marker,
      // and it was made by a bot (by this App, when its id is known). Up to 500 comments are searched.
      let mine: { id: number } | undefined;
      for (let page = 1; page <= MAX_COMMENT_PAGES && !mine; page++) {
        const listed = await gh.request(
          "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
          {
            ...at,
            issue_number: data.number,
            per_page: 100,
            page,
          },
        );
        const rows = Array.isArray(listed.data) ? listed.data : [];
        mine = rows.find((c) => {
          const row = c as {
            body?: unknown;
            id?: unknown;
            user?: { type?: unknown } | null;
            performed_via_github_app?: { id?: unknown } | null;
          };
          return (
            typeof row.body === "string" &&
            row.body.split("\n", 1)[0] === marker &&
            row.user?.type === "Bot" &&
            (appId === null || row.performed_via_github_app?.id === appId) &&
            typeof row.id === "number"
          );
        }) as { id: number } | undefined;
        if (rows.length < 100) break;
      }
      let comment: "created" | "updated" = "created";
      if (mine) {
        try {
          await gh.request("PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}", {
            ...at,
            comment_id: mine.id,
            body,
          });
          comment = "updated";
        } catch (err) {
          // Another bot's comment that happens to start with our marker cannot be edited: post our own.
          if (!denied(err)) throw err;
        }
      }
      if (comment === "created") {
        await gh.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
          ...at,
          issue_number: data.number,
          body,
        });
      }
      // The check run never blocks a merge: neutral when something needs a look, success when nothing does.
      let check = true;
      try {
        await gh.request("POST /repos/{owner}/{repo}/check-runs", {
          ...at,
          name: CHECK_NAME,
          head_sha: data.headSha,
          status: "completed",
          conclusion: counts.receipts > 0 && prReceiptClean(counts) ? "success" : "neutral",
          output: { title: CHECK_NAME, summary: prReceiptCheckSummary(counts) },
        });
      } catch (err) {
        if (!denied(err)) throw err;
        check = false;
      }
      return { receipts: counts.receipts, comment, check };
    });
  } catch (err) {
    // The App has no permission for pull requests on this repository (owner action 13): nothing is posted.
    if (denied(err)) return { skipped: "no_permission" };
    throw err;
  }
}
