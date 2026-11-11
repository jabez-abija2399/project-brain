import { getDb } from "./db";
import { getGithubApp, githubConfig } from "./github";
import { PR_EVENT, PUSH_EVENT, type PrEventData, type PushEventData, inngest } from "./inngest";
import { runPrReceipt } from "./pr-receipt";
import type { GithubClient, StepRunner } from "./push-index";
import { runPushJob } from "./push-receipt";

// The installation's Octokit: a short-lived token for just that installation, never stored or logged.
export async function installationClient(installationId: number): Promise<GithubClient> {
  const config = githubConfig();
  if (!config) throw new Error("GitHub App is not configured");
  return (await getGithubApp(config).getInstallationOctokit(
    installationId,
  )) as unknown as GithubClient;
}

// One push job at a time per project (spec section 5), so two pushes never index the same project concurrently.
export const indexPushFunction = inngest.createFunction(
  {
    id: "index-push",
    triggers: [{ event: PUSH_EVENT }],
    concurrency: { limit: 1, key: "event.data.projectId" },
  },
  async ({ event, step }) => {
    const data = event.data as PushEventData;
    return runPushJob(getDb(), data, step as unknown as StepRunner, () =>
      installationClient(data.installationId),
    );
  },
);

// Roadmap Phase 10b: one pull-request job at a time per project; only sent for projects with PR receipts on.
export const prReceiptFunction = inngest.createFunction(
  {
    id: "pr-receipt",
    triggers: [{ event: PR_EVENT }],
    concurrency: { limit: 1, key: "event.data.projectId" },
  },
  async ({ event, step }) => {
    const data = event.data as PrEventData;
    return runPrReceipt(
      getDb(),
      data,
      step as unknown as StepRunner,
      () => installationClient(data.installationId),
      // The app's own address (BETTER_AUTH_URL); without it no link is written into the comment.
      process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL).origin : "",
      Number.isInteger(Number(githubConfig()?.appId)) ? Number(githubConfig()?.appId) : null,
    );
  },
);
