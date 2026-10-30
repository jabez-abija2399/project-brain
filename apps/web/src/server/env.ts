// Production configuration check (docs/deploy.md). Reads only whether each variable is set and well formed; no value
// ever reaches a message, a log or a response.

export const REQUIRED_ENV = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_APP_ID",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "ANTHROPIC_API_KEY",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
] as const;

// Needed by the GitHub App install flow too; reported (as names) when missing, without stopping the server.
export const GITHUB_APP_EXTRA_ENV = [
  "GITHUB_APP_SLUG",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
] as const;

type Env = Record<string, string | undefined>;
const isSet = (env: Env, name: string) => (env[name] ?? "").trim() !== "";

/**
 * A .pem from an env var: pasted with real newlines, with "\n" escapes (one-line form), with Windows line ends, or
 * wrapped in quotes. Always returns the PEM with real newlines.
 */
export function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  return key
    .replace(/\\r\\n|\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();
}

const PEM = /^-----BEGIN (?:RSA )?PRIVATE KEY-----\n[\s\S]+\n-----END (?:RSA )?PRIVATE KEY-----$/;

/** Problems with the production environment, as names and rules only (never a value). Empty when all is well. */
export function productionEnvProblems(env: Env): string[] {
  const problems: string[] = [];
  const missing = REQUIRED_ENV.filter((name) => !isSet(env, name));
  if (missing.length > 0) problems.push(`missing ${missing.join(", ")}`);
  if (isSet(env, "GITHUB_APP_PRIVATE_KEY")) {
    if (!PEM.test(normalizePrivateKey(env.GITHUB_APP_PRIVATE_KEY ?? ""))) {
      problems.push(
        "GITHUB_APP_PRIVATE_KEY is not a PEM private key (paste the whole .pem file, with real newlines or \\n)",
      );
    }
  }
  if (isSet(env, "BETTER_AUTH_URL") && !/^https:\/\/[^\s/]+/.test(env.BETTER_AUTH_URL ?? "")) {
    problems.push("BETTER_AUTH_URL must be the app's https:// address");
  }
  if (isSet(env, "DATABASE_URL") && !/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL ?? "")) {
    problems.push("DATABASE_URL must be a postgres:// connection string");
  }
  return problems;
}

/** One line naming what is wrong (variable names only), or null when the environment is complete. */
export function productionEnvError(env: Env): string | null {
  const problems = productionEnvProblems(env);
  if (problems.length === 0) return null;
  return `Codeceipt cannot start: ${problems.join("; ")}. Set them in Vercel > Project > Settings > Environment Variables (docs/deploy.md).`;
}

/**
 * Called once when the server boots (instrumentation.ts). In production a missing or malformed variable stops the
 * server with one clear message; in development and tests nothing is required.
 */
export function assertProductionEnv(env: Env = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const error = productionEnvError(env);
  if (error) throw new Error(error);
  const extra = GITHUB_APP_EXTRA_ENV.filter((name) => !isSet(env, name));
  if (extra.length > 0) {
    console.warn(
      `[startup] GitHub App install flow is off until these are set: ${extra.join(", ")}`,
    );
  }
}

/** Which optional services are set up (booleans only), for /api/health. */
export function configuredServices(env: Env = process.env) {
  const all = (names: readonly string[]) => names.every((n) => isSet(env, n));
  return {
    githubApp: all([
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_WEBHOOK_SECRET",
      ...GITHUB_APP_EXTRA_ENV,
    ]),
    inngest: all(["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"]),
    ai: isSet(env, "ANTHROPIC_API_KEY"),
  };
}
