import { App } from "@octokit/app";
import { Webhooks } from "@octokit/webhooks";
import { normalizePrivateKey } from "./env";

// The GitHub App's settings (FEAT-009). Secrets only from the environment (names in .env.example), never logged.
export type GithubConfig = {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  slug: string;
  clientId: string;
  clientSecret: string;
};

export function githubConfigFrom(env: Record<string, string | undefined>): GithubConfig | null {
  const appId = env.GITHUB_APP_ID;
  const privateKey = env.GITHUB_APP_PRIVATE_KEY;
  const webhookSecret = env.GITHUB_WEBHOOK_SECRET;
  const slug = env.GITHUB_APP_SLUG;
  const clientId = env.GITHUB_APP_CLIENT_ID;
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET;
  if (!appId || !privateKey || !webhookSecret || !slug || !clientId || !clientSecret) return null;
  // The .pem may be pasted with real newlines or as one line with \n (docs/deploy.md).
  return {
    appId,
    privateKey: normalizePrivateKey(privateKey),
    webhookSecret,
    slug,
    clientId,
    clientSecret,
  };
}

let override: GithubConfig | null | undefined;
let cached: { config: GithubConfig; app: App } | null = null;

export function githubConfig(): GithubConfig | null {
  return override !== undefined ? override : githubConfigFrom(process.env);
}

// Test-only: inject a config with a key and secret made at runtime (undefined restores the environment).
export function setGithubConfigForTests(config: GithubConfig | null | undefined): void {
  override = config;
  cached = null;
}

export function getGithubApp(config: GithubConfig): App {
  if (cached?.config === config) return cached.app;
  const app = new App({
    appId: config.appId,
    privateKey: config.privateKey,
    oauth: { clientId: config.clientId, clientSecret: config.clientSecret },
    // The SDK's own debug/info logs could carry URLs and ids; keep only warnings and errors, without arguments.
    log: {
      debug: () => {},
      info: () => {},
      warn: () => console.warn("[github] warning"),
      error: () => console.error("[github] error"),
    },
  });
  cached = { config, app };
  return app;
}

// HMAC SHA-256 of the raw body (timing-safe compare in @octokit/webhooks). A missing or malformed header is false.
export async function verifySignature(
  secret: string,
  rawBody: string,
  header: string | null,
): Promise<boolean> {
  if (!header || !/^sha256=[0-9a-f]{64}$/.test(header)) return false;
  try {
    return await new Webhooks({ secret }).verify(rawBody, header);
  } catch {
    return false;
  }
}
