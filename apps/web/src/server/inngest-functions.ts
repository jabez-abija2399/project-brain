import { getDb } from "./db";
import { getGithubApp, githubConfig } from "./github";
import { PUSH_EVENT, type PushEventData, inngest } from "./inngest";
import { type GithubClient, type StepRunner, runPushIndex } from "./push-index";

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
    return runPushIndex(getDb(), data, step as unknown as StepRunner, () =>
      installationClient(data.installationId),
    );
  },
);
