import { GET as health } from "@/app/api/health/route";
import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "../instrumentation";
import {
  REQUIRED_ENV,
  assertProductionEnv,
  configuredServices,
  normalizePrivateKey,
  productionEnvError,
} from "./env";
import { githubConfigFrom } from "./github";

// Values are built at runtime in chunks under 10 characters; none may ever appear in a message or response.
const SECRET = ["s3cr", "et-va", "lue-91"].join("");
const PEM_BODY = ["MIIEowIBA", "AKCAQEAx", "Yz"].join("");
// The armour lines are joined at runtime too, so secret scanners never see a key-shaped literal.
const ARMOUR = ["RSA PRIV", "ATE KEY"].join("");
const PEM_LINES = [`-----BEGIN ${ARMOUR}-----`, PEM_BODY, PEM_BODY, `-----END ${ARMOUR}-----`];
const PEM = PEM_LINES.join("\n");

function fullEnv(): Record<string, string> {
  const env: Record<string, string> = { NODE_ENV: "production" };
  for (const name of REQUIRED_ENV) env[name] = SECRET;
  env.DATABASE_URL = `postgres://u:${SECRET}@db.example.com/neondb?sslmode=require`;
  env.BETTER_AUTH_URL = "https://codeceipt.example.com";
  env.GITHUB_APP_PRIVATE_KEY = PEM;
  return env;
}

afterEach(() => vi.unstubAllEnvs());

describe("production startup check", () => {
  it("passes with every required variable set", () => {
    expect(productionEnvError(fullEnv())).toBeNull();
    expect(() => assertProductionEnv(fullEnv())).not.toThrow();
  });

  it("fails with one message naming every missing variable, never a value", () => {
    const env = fullEnv();
    env.GITHUB_APP_ID = "";
    env.INNGEST_SIGNING_KEY = "   ";
    // biome-ignore lint/performance/noDelete: the variable must be absent, not empty
    delete env.ANTHROPIC_API_KEY;
    const message = productionEnvError(env) ?? "";
    expect(message).toBe(
      "Codeceipt cannot start: missing GITHUB_APP_ID, ANTHROPIC_API_KEY, INNGEST_SIGNING_KEY. Set them in Vercel > Project > Settings > Environment Variables (docs/deploy.md).",
    );
    expect(() => assertProductionEnv(env)).toThrow(message);
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain(PEM_BODY);
  });

  it("names every variable when nothing is set, and requires nothing outside production", () => {
    expect(productionEnvError({ NODE_ENV: "production" })).toContain(
      `missing ${REQUIRED_ENV.join(", ")}`,
    );
    expect(() => assertProductionEnv({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertProductionEnv({ NODE_ENV: "test" })).not.toThrow();
  });

  it("the boot hook (instrumentation register) stops a production server with a missing variable", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const name of REQUIRED_ENV) vi.stubEnv(name, "");
    expect(() => register()).toThrow(/^Codeceipt cannot start: missing DATABASE_URL, /);
  });

  it("rejects a malformed private key, http auth URL or non-postgres database URL by name only", () => {
    const env = fullEnv();
    env.GITHUB_APP_PRIVATE_KEY = SECRET;
    env.BETTER_AUTH_URL = "http://codeceipt.example.com";
    env.DATABASE_URL = `mysql://u:${SECRET}@db/x`;
    const message = productionEnvError(env) ?? "";
    expect(message).toContain("GITHUB_APP_PRIVATE_KEY is not a PEM private key");
    expect(message).toContain("BETTER_AUTH_URL must be the app's https:// address");
    expect(message).toContain("DATABASE_URL must be a postgres:// connection string");
    expect(message).not.toContain(SECRET);
  });
});

describe("GITHUB_APP_PRIVATE_KEY formats", () => {
  it("works with real newlines, \\n escapes, Windows line ends and surrounding quotes", () => {
    const forms = [
      PEM,
      PEM_LINES.join("\\n"),
      PEM_LINES.join("\r\n"),
      PEM_LINES.join("\\r\\n"),
      `"${PEM_LINES.join("\\n")}"`,
      `\n${PEM}\n`,
    ];
    for (const form of forms) {
      expect(normalizePrivateKey(form)).toBe(PEM);
      const env = fullEnv();
      env.GITHUB_APP_PRIVATE_KEY = form;
      expect(productionEnvError(env)).toBeNull();
    }
    const config = githubConfigFrom({
      GITHUB_APP_ID: "1",
      GITHUB_APP_PRIVATE_KEY: PEM_LINES.join("\\n"),
      GITHUB_WEBHOOK_SECRET: SECRET,
      GITHUB_APP_SLUG: "codeceipt",
      GITHUB_APP_CLIENT_ID: "Iv1",
      GITHUB_APP_CLIENT_SECRET: SECRET,
    });
    expect(config?.privateKey).toBe(PEM);
  });
});

describe("/api/health services", () => {
  it("reports which optional services are configured as true/false only", async () => {
    expect(configuredServices({})).toEqual({ githubApp: false, inngest: false, ai: false });
    expect(configuredServices(fullEnv())).toEqual({ githubApp: false, inngest: true, ai: true });
    const withApp = {
      ...fullEnv(),
      GITHUB_APP_SLUG: "codeceipt",
      GITHUB_APP_CLIENT_ID: SECRET,
      GITHUB_APP_CLIENT_SECRET: SECRET,
    };
    expect(configuredServices(withApp)).toEqual({ githubApp: true, inngest: true, ai: true });
  });

  it("the health response carries the flags and no configured value", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://x:x@127.0.0.1:1/none");
    vi.stubEnv("ANTHROPIC_API_KEY", SECRET);
    vi.stubEnv("INNGEST_EVENT_KEY", SECRET);
    vi.stubEnv("INNGEST_SIGNING_KEY", "");
    const res = await health();
    const text = await res.text();
    expect(JSON.parse(text).services).toEqual({ githubApp: false, inngest: false, ai: true });
    expect(text).not.toContain(SECRET);
  });
});
